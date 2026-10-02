import { supabase } from './supabase.ts'

/**
 * Display copy only (e.g. the FAQ). The amount actually charged is set by
 * public.loan_penalty_per_day() in the database — keep the two in sync.
 */
export const PENALTY_PER_DAY = 100

/**
 * Interest + penalties may not exceed this multiple of the principal; set by
 * public.loan_total_cost_cap() in the database. Display copy only.
 */
export const PENALTY_TOTAL_COST_CAP = 1

/**
 * Late-payment position of a disbursed loan, computed by the database
 * (public.loan_penalty_status) — the single source of truth for penalties.
 */
export interface PenaltyStatus {
  application_id: string
  as_of: string
  days_overdue: number
  installments_overdue: number
  amount_overdue: number
  penalty_per_day: number
  penalty_accrued: number
  penalty_paid: number
  penalty_due: number
  installments_paid: number
  total_installments: number
  /** Most this loan can ever be charged in penalties. */
  penalty_cap: number
}

type Row = Record<keyof PenaltyStatus, unknown>

function normalize(row: Row): PenaltyStatus {
  return {
    application_id: String(row.application_id),
    as_of: String(row.as_of),
    days_overdue: Number(row.days_overdue),
    installments_overdue: Number(row.installments_overdue),
    amount_overdue: Number(row.amount_overdue),
    penalty_per_day: Number(row.penalty_per_day),
    penalty_accrued: Number(row.penalty_accrued),
    penalty_paid: Number(row.penalty_paid),
    penalty_due: Number(row.penalty_due),
    installments_paid: Number(row.installments_paid),
    total_installments: Number(row.total_installments),
    penalty_cap: Number(row.penalty_cap ?? 0),
  }
}

/** True once penalties have hit the cap and stopped growing. */
export const penaltyCapReached = (s: PenaltyStatus) => s.penalty_cap > 0 && s.penalty_accrued >= s.penalty_cap - 0.005

/** Amount needed today to bring the loan current: overdue installments plus unpaid penalties. */
export const amountDueNow = (s: PenaltyStatus) => Math.round((s.amount_overdue + s.penalty_due) * 100) / 100

/** Penalty status for every disbursed/paid loan the caller may see, keyed by application id. */
export async function fetchPenaltyStatuses(): Promise<Map<string, PenaltyStatus>> {
  const { data, error } = await supabase.rpc('loan_penalty_statuses')
  // Penalties are informational on list screens; never block them on this call.
  if (error || !data) return new Map()
  return new Map((data as Row[]).map((r) => [String(r.application_id), normalize(r)]))
}

export async function fetchPenaltyStatus(applicationId: string): Promise<PenaltyStatus | null> {
  const { data, error } = await supabase.rpc('loan_penalty_status', { p_application_id: applicationId })
  if (error) throw new Error(error.message)
  const row = (data as Row[] | null)?.[0]
  return row ? normalize(row) : null
}
