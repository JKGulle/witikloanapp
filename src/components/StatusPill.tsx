import type { KycStatus, LoanStatus } from '../lib/types.ts'

const LABELS: Record<LoanStatus | KycStatus, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  disbursed: 'Active',
  paid: 'Paid off',
  cancelled: 'Cancelled',
  unverified: 'Not verified',
  verified: 'Verified',
}

export function StatusPill({ status }: { status: LoanStatus | KycStatus }) {
  return <span className={`pill pill--${status}`}>{LABELS[status]}</span>
}
