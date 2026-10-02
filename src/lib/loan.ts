import type { LoanApplication, Payment } from './types'

export const LOCALE = 'en-PH'
export const CURRENCY = 'PHP'

/** Must stay in sync with the CHECK constraints on public.loan_applications. */
export const LOAN_LIMITS = {
  minAmount: 1_000,
  maxAmount: 500_000,
  amountStep: 500,
  /** Google Play rejects personal loans repayable in 60 days or less. */
  minTerm: 3,
  maxTerm: 36,
} as const

/** Must stay in sync with public.loan_annual_rate() in the database. */
export function annualRateFor(termMonths: number): number {
  if (termMonths <= 6) return 12
  if (termMonths <= 12) return 15
  return 18
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function monthlyPayment(principal: number, annualRatePct: number, months: number): number {
  const r = annualRatePct / 100 / 12
  if (r === 0) return round2(principal / months)
  return round2((principal * r) / (1 - Math.pow(1 + r, -months)))
}

/** A monthly payment above this share of income is flagged as hard to afford. */
export const AFFORDABILITY_RATIO = 0.4

/**
 * Largest loan amount (in amountStep increments, within limits) whose monthly
 * payment stays within AFFORDABILITY_RATIO of the given monthly income.
 * Returns null when even the minimum amount isn't affordable.
 */
export function affordableAmount(monthlyIncome: number, months: number): number | null {
  const budget = monthlyIncome * AFFORDABILITY_RATIO
  const r = annualRateFor(months) / 100 / 12
  const raw = (budget * (1 - Math.pow(1 + r, -months))) / r
  let amount = Math.min(LOAN_LIMITS.maxAmount, Math.floor(raw / LOAN_LIMITS.amountStep) * LOAN_LIMITS.amountStep)
  // Guard against rounding pushing the payment a centavo over budget.
  while (amount >= LOAN_LIMITS.minAmount && monthlyPayment(amount, annualRateFor(months), months) > budget) {
    amount -= LOAN_LIMITS.amountStep
  }
  return amount >= LOAN_LIMITS.minAmount ? amount : null
}

export interface ScheduleRow {
  installment: number
  dueDate: Date
  payment: number
  principal: number
  interest: number
  balance: number
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return d
}

export function amortizationSchedule(
  principal: number,
  annualRatePct: number,
  months: number,
  start: Date,
): ScheduleRow[] {
  const r = annualRatePct / 100 / 12
  const payment = monthlyPayment(principal, annualRatePct, months)
  const rows: ScheduleRow[] = []
  let balance = principal

  for (let i = 1; i <= months; i++) {
    const interest = round2(balance * r)
    // The final installment absorbs rounding so the balance lands exactly on zero.
    const isLast = i === months
    const principalPart = isLast ? round2(balance) : round2(payment - interest)
    balance = round2(balance - principalPart)
    rows.push({
      installment: i,
      dueDate: addMonths(start, i),
      payment: isLast ? round2(principalPart + interest) : payment,
      principal: principalPart,
      interest,
      balance: Math.max(0, balance),
    })
  }
  return rows
}

export function loanQuote(principal: number, months: number) {
  const annualRate = annualRateFor(months)
  const schedule = amortizationSchedule(principal, annualRate, months, new Date())
  const totalPayable = round2(schedule.reduce((sum, row) => sum + row.payment, 0))
  return {
    annualRate,
    payment: monthlyPayment(principal, annualRate, months),
    totalPayable,
    totalInterest: round2(totalPayable - principal),
  }
}

/**
 * Installment progress. `penaltyPaid` is the part of the payments the database
 * applied to late penalties (penalties are paid first), so it doesn't count
 * toward installments.
 */
export function loanProgress(app: LoanApplication, payments: Payment[], penaltyPaid = 0) {
  const start = new Date(app.disbursed_at ?? app.created_at)
  const schedule = amortizationSchedule(Number(app.amount), Number(app.annual_rate), app.term_months, start)
  const totalPayable = round2(schedule.reduce((sum, row) => sum + row.payment, 0))
  const totalPaid = round2(
    Math.max(
      0,
      payments.filter((p) => p.application_id === app.id).reduce((sum, p) => sum + Number(p.amount), 0) - penaltyPaid,
    ),
  )

  let covered = 0
  let paidInstallments = 0
  for (const row of schedule) {
    if (covered + row.payment > totalPaid + 0.005) break
    covered += row.payment
    paidInstallments++
  }

  const nextDue = schedule[paidInstallments] ?? null

  return {
    schedule,
    totalPayable,
    totalPaid,
    outstanding: Math.max(0, round2(totalPayable - totalPaid)),
    paidInstallments,
    nextDue,
    /** What's left of the next installment after any partial payment toward it. */
    nextDueRemaining: nextDue ? Math.max(0, round2(nextDue.payment - (totalPaid - covered))) : 0,
    percentPaid: totalPayable > 0 ? Math.min(100, (totalPaid / totalPayable) * 100) : 0,
  }
}

const moneyFormat = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  maximumFractionDigits: 2,
})
const moneyFormatWhole = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  maximumFractionDigits: 0,
})
const dateFormat = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' })

export const formatMoney = (n: number, whole = false) => (whole ? moneyFormatWhole : moneyFormat).format(n)
export const formatDate = (d: Date | string) => dateFormat.format(typeof d === 'string' ? new Date(d) : d)
