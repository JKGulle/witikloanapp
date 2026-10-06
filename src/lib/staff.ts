import type { AuditEntry, StaffRole } from './types.ts'

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: 'Admin',
  credit_investigator: 'Credit Investigator',
  cashier: 'Cashier',
}

/** Title of the applications queue for each role. */
export const QUEUE_TITLES: Record<StaffRole, string> = {
  admin: 'Applications',
  credit_investigator: 'My assignments',
  cashier: 'Cashier desk',
}

export const EMPLOYMENT_LABELS: Record<string, string> = {
  employed: 'Employed',
  self_employed: 'Self-employed',
  unemployed: 'Unemployed',
  student: 'Student',
  retired: 'Retired',
}

/** Embedded columns used by every staff application query. */
export const STAFF_APPLICATION_SELECT =
  '*, profile:profiles(*), investigator:staff(full_name), investigation:investigations(*), collateral:loan_collateral(*)'

const ACTION_LABELS: Record<string, string> = {
  'staff.granted': 'Granted staff role',
  'staff.deactivated': 'Deactivated staff',
  'staff.reactivated': 'Reactivated staff',
  'application.assigned': 'Assigned investigator',
  'investigation.submitted': 'Submitted investigation',
  'application.approved': 'Approved application',
  'application.rejected': 'Rejected application',
  'application.rate_adjusted': 'Adjusted interest rate',
  'loan.disbursed': 'Released loan',
  'payment.recorded': 'Recorded payment',
  'payment.submitted': 'Submitted e-wallet payment',
  'payment.approved': 'Approved e-wallet payment',
  'payment.rejected': 'Rejected e-wallet payment',
  'payment_channel.saved': 'Saved e-wallet account',
  'loan.paid': 'Loan fully paid',
  'collateral.offered': 'Offered ATM card as collateral',
  'collateral.withdrawn': 'Withdrew ATM card collateral',
  'collateral.received': 'Received ATM card',
  'collateral.returned': 'Returned ATM card',
  'contract.accepted': 'Accepted loan agreement',
  'kyc.submitted': 'Submitted KYC documents',
  'kyc.verified': 'Verified KYC',
  'kyc.rejected': 'Rejected KYC',
  'kyc.pending': 'Set KYC to pending',
  'kyc.unverified': 'Reset KYC',
  'offer.set': 'Set loan offer',
  'offer.removed': 'Removed loan offer',
}

export function describeAction(entry: AuditEntry): string {
  return ACTION_LABELS[entry.action] ?? entry.action
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
