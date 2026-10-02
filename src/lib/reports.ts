import type { LoanApplication, Payment } from './types.ts'
import type { PenaltyStatus } from './penalty.ts'

export type PeriodKind = 'day' | 'week' | 'month' | 'year' | 'range'

export interface Period {
  kind: PeriodKind
  /** Inclusive start, local midnight. */
  start: Date
  /** Exclusive end, local midnight after the last day. */
  end: Date
  label: string
}

export interface Bucket {
  start: Date
  end: Date
  label: string
}

const LOCALE = 'en-PH'
const DAY_MS = 86_400_000

// ─────────────────────────── Dates (local time) ───────────────────────────
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1)
/** Weeks run Monday to Sunday. */
const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7))

export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function parseISODate(value: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '')
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(LOCALE, opts)
const fullDate = fmt({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
const shortDate = fmt({ month: 'short', day: 'numeric', year: 'numeric' })
const monthYear = fmt({ month: 'long', year: 'numeric' })

// ─────────────────────────── Periods ───────────────────────────
export function makePeriod(kind: PeriodKind, anchor: Date, rangeEnd?: Date): Period {
  const a = startOfDay(anchor)
  switch (kind) {
    case 'day':
      return { kind, start: a, end: addDays(a, 1), label: fullDate.format(a) }
    case 'week': {
      const s = startOfWeek(a)
      return { kind, start: s, end: addDays(s, 7), label: `Week of ${shortDate.format(s)} – ${shortDate.format(addDays(s, 6))}` }
    }
    case 'month': {
      const s = new Date(a.getFullYear(), a.getMonth(), 1)
      return { kind, start: s, end: addMonths(s, 1), label: monthYear.format(s) }
    }
    case 'year': {
      const s = new Date(a.getFullYear(), 0, 1)
      return { kind, start: s, end: new Date(a.getFullYear() + 1, 0, 1), label: String(a.getFullYear()) }
    }
    case 'range': {
      let from = a
      let to = startOfDay(rangeEnd ?? a)
      if (to < from) [from, to] = [to, from]
      return { kind, start: from, end: addDays(to, 1), label: `${shortDate.format(from)} – ${shortDate.format(to)}` }
    }
  }
}

/** The previous (-1) or next (+1) period of the same kind. */
export function shiftPeriod(p: Period, dir: -1 | 1): Period {
  switch (p.kind) {
    case 'day':
      return makePeriod('day', addDays(p.start, dir))
    case 'week':
      return makePeriod('week', addDays(p.start, 7 * dir))
    case 'month':
      return makePeriod('month', addMonths(p.start, dir))
    case 'year':
      return makePeriod('year', new Date(p.start.getFullYear() + dir, 0, 1))
    case 'range': {
      const days = Math.round((p.end.getTime() - p.start.getTime()) / DAY_MS)
      return makePeriod('range', addDays(p.start, days * dir), addDays(p.end, days * dir - 1))
    }
  }
}

/** Chart buckets: hours for a single day, days up to ~2 months, months beyond. */
export function makeBuckets(p: Period): Bucket[] {
  const buckets: Bucket[] = []
  const days = Math.round((p.end.getTime() - p.start.getTime()) / DAY_MS)
  if (days <= 1) {
    for (let h = 0; h < 24; h++) {
      const start = new Date(p.start.getFullYear(), p.start.getMonth(), p.start.getDate(), h)
      buckets.push({ start, end: new Date(start.getTime() + 3_600_000), label: `${String(h).padStart(2, '0')}:00` })
    }
  } else if (days <= 62) {
    const label = fmt(days <= 7 ? { weekday: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' })
    for (let d = p.start; d < p.end; d = addDays(d, 1)) buckets.push({ start: d, end: addDays(d, 1), label: label.format(d) })
  } else {
    const label = fmt(p.start.getFullYear() === addDays(p.end, -1).getFullYear() ? { month: 'short' } : { month: 'short', year: '2-digit' })
    for (let m = new Date(p.start.getFullYear(), p.start.getMonth(), 1); m < p.end; m = addMonths(m, 1)) {
      buckets.push({ start: m < p.start ? p.start : m, end: addMonths(m, 1) > p.end ? p.end : addMonths(m, 1), label: label.format(m) })
    }
  }
  return buckets
}

const within = (iso: string | null | undefined, p: { start: Date; end: Date }) => {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return t >= p.start.getTime() && t < p.end.getTime()
}

// ─────────────────────────── Report ───────────────────────────
export type ReportApplication = LoanApplication & { profile: { full_name: string | null } | null }

export interface ReportInput {
  applications: ReportApplication[]
  /** Payments made inside the period. */
  payments: Payment[]
  /** Audit rows inside the period: payment.recorded, kyc.verified, kyc.rejected. */
  audit: { action: string; details: Record<string, unknown>; created_at: string }[]
  /** KYC submissions made inside the period. */
  kycSubmitted: number
  /** Current penalty position of disbursed/paid loans (portfolio snapshot). */
  penalties: Map<string, PenaltyStatus>
  staffNames: Map<string, string>
}

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100

export function buildReport(input: ReportInput, period: Period) {
  const { applications, payments, audit, penalties, staffNames } = input
  const borrower = (a: ReportApplication) => a.profile?.full_name || 'Unnamed borrower'
  const staff = (id: string | null) => (id ? (staffNames.get(id) ?? 'Former staff') : 'Not recorded')

  // Applications
  const received = applications.filter((a) => within(a.created_at, period))
  const decided = applications.filter((a) => within(a.decided_at, period))
  const approved = decided.filter((a) => ['approved', 'disbursed', 'paid'].includes(a.status))
  const rejected = decided.filter((a) => a.status === 'rejected')
  const cancelled = decided.filter((a) => a.status === 'cancelled')
  const approvalRate = approved.length + rejected.length > 0 ? approved.length / (approved.length + rejected.length) : null

  const byPurpose = new Map<string, { count: number; amount: number }>()
  for (const a of received) {
    const row = byPurpose.get(a.purpose) ?? { count: 0, amount: 0 }
    row.count++
    row.amount += Number(a.amount)
    byPurpose.set(a.purpose, row)
  }

  // Releases
  const released = applications
    .filter((a) => within(a.disbursed_at, period))
    .sort((a, b) => a.disbursed_at!.localeCompare(b.disbursed_at!))
    .map((a) => ({
      id: a.id,
      at: a.disbursed_at!,
      borrower: borrower(a),
      purpose: a.purpose,
      amount: Number(a.amount),
      reference: a.disbursement_reference,
      by: staff(a.disbursed_by),
    }))

  // Collections
  const appById = new Map(applications.map((a) => [a.id, a]))
  const collected = [...payments]
    .sort((a, b) => a.paid_at.localeCompare(b.paid_at))
    .map((p) => ({
      id: p.id,
      at: p.paid_at,
      borrower: appById.get(p.application_id) ? borrower(appById.get(p.application_id)!) : 'Unknown',
      applicationId: p.application_id,
      amount: Number(p.amount),
      reference: p.reference,
      by: staff(p.received_by),
    }))
  const totalCollected = sum(collected.map((c) => c.amount))
  const penaltiesCollected = sum(
    audit.filter((e) => e.action === 'payment.recorded').map((e) => Number(e.details.to_penalty ?? 0)),
  )

  const byCashier = new Map<string, { releases: number; released: number; payments: number; collected: number }>()
  const cashier = (name: string) => {
    const row = byCashier.get(name) ?? { releases: 0, released: 0, payments: 0, collected: 0 }
    byCashier.set(name, row)
    return row
  }
  for (const r of released) {
    const row = cashier(r.by)
    row.releases++
    row.released += r.amount
  }
  for (const c of collected) {
    const row = cashier(c.by)
    row.payments++
    row.collected += c.amount
  }

  // Trend
  const buckets = makeBuckets(period).map((b) => ({
    ...b,
    applications: received.filter((a) => within(a.created_at, b)).length,
    released: sum(released.filter((r) => within(r.at, b)).map((r) => r.amount)),
    collected: sum(collected.filter((c) => within(c.at, b)).map((c) => c.amount)),
  }))

  // Portfolio snapshot (now)
  const active = applications.filter((a) => a.status === 'disbursed')
  let outstanding = 0
  let atRisk = 0
  let amountOverdue = 0
  let penaltiesDue = 0
  const overdueLoans: { id: string; borrower: string; days: number; dueNow: number }[] = []
  for (const a of active) {
    const s = penalties.get(a.id)
    if (!s) continue
    const owed = s.total_installments - s.installments_paid + s.penalty_due
    outstanding += owed
    penaltiesDue += s.penalty_due
    if (s.days_overdue > 0) {
      atRisk += owed
      amountOverdue += s.amount_overdue
      overdueLoans.push({ id: a.id, borrower: borrower(a), days: s.days_overdue, dueNow: s.amount_overdue + s.penalty_due })
    }
  }
  overdueLoans.sort((a, b) => b.days - a.days)

  return {
    applications: {
      received: received.length,
      requested: sum(received.map((a) => Number(a.amount))),
      approved: approved.length,
      rejected: rejected.length,
      cancelled: cancelled.length,
      approvalRate,
      byPurpose: [...byPurpose.entries()].map(([purpose, v]) => ({ purpose, ...v })).sort((a, b) => b.amount - a.amount),
    },
    releases: { count: released.length, total: sum(released.map((r) => r.amount)), rows: released },
    collections: {
      count: collected.length,
      total: totalCollected,
      penalties: penaltiesCollected,
      installments: sum([totalCollected, -penaltiesCollected]),
      rows: collected,
    },
    byCashier: [...byCashier.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.collected + b.released - (a.collected + a.released)),
    kyc: {
      submitted: input.kycSubmitted,
      verified: audit.filter((e) => e.action === 'kyc.verified').length,
      rejected: audit.filter((e) => e.action === 'kyc.rejected').length,
    },
    portfolio: {
      activeLoans: active.length,
      paidOff: applications.filter((a) => a.status === 'paid').length,
      outstanding: Math.round(outstanding * 100) / 100,
      overdueCount: overdueLoans.length,
      amountOverdue: Math.round(amountOverdue * 100) / 100,
      penaltiesDue: Math.round(penaltiesDue * 100) / 100,
      portfolioAtRisk: outstanding > 0 ? atRisk / outstanding : 0,
      overdueLoans,
    },
    buckets,
  }
}

export type Report = ReturnType<typeof buildReport>
