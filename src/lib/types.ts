export type LoanStatus = 'pending' | 'approved' | 'rejected' | 'disbursed' | 'paid' | 'cancelled'

export type KycStatus = 'unverified' | 'pending' | 'verified' | 'rejected'

export type EmploymentStatus = 'employed' | 'self_employed' | 'unemployed' | 'student' | 'retired'

export interface Profile {
  id: string
  full_name: string | null
  phone: string | null
  date_of_birth: string | null
  address: string | null
  employment_status: EmploymentStatus | null
  monthly_income: number | null
  kyc_status: KycStatus
  created_at: string
  updated_at: string
}

export interface LoanApplication {
  id: string
  user_id: string
  amount: number
  term_months: number
  purpose: string
  annual_rate: number
  monthly_payment: number
  status: LoanStatus
  created_at: string
  decided_at: string | null
  disbursed_at: string | null
  disbursed_by: string | null
  disbursement_reference: string | null
  investigator_id: string | null
  assigned_at: string | null
  decision_reason: string | null
  decided_by: string | null
}

export type IdType = 'philsys' | 'passport' | 'drivers_license' | 'umid' | 'sss' | 'prc' | 'postal' | 'voters'

export interface KycSubmission {
  user_id: string
  id_type: IdType
  id_front_path: string
  id_back_path: string | null
  selfie_path: string
  submitted_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  review_note: string | null
}

export type StaffRole = 'admin' | 'credit_investigator' | 'cashier'

export interface Staff {
  user_id: string
  role: StaffRole
  full_name: string
  email: string
  active: boolean
  created_by: string | null
  created_at: string
}

export type RiskRating = 'low' | 'medium' | 'high'
export type Recommendation = 'approve' | 'reject'

export interface Investigation {
  application_id: string
  investigator_id: string
  employment_verified: boolean
  income_verified: boolean
  residence_verified: boolean
  risk_rating: RiskRating
  recommendation: Recommendation
  notes: string | null
  submitted_at: string
}

export interface AuditEntry {
  id: number
  actor_id: string | null
  action: string
  application_id: string | null
  subject_user_id: string | null
  details: Record<string, unknown>
  created_at: string
}

/** Shape returned by the staff application queries (embedded relations). */
export interface StaffApplication extends LoanApplication {
  profile: Profile | null
  investigator: Pick<Staff, 'full_name'> | null
  investigation: Investigation | null
  collateral: LoanCollateral | null
}

export interface Payment {
  id: string
  application_id: string
  user_id: string
  amount: number
  reference: string | null
  received_by: string | null
  paid_at: string
}

export type EwalletProvider = 'gcash' | 'maya'

/** One of Witik's receiving e-wallet accounts. */
export interface PaymentChannel {
  id: string
  provider: EwalletProvider
  account_name: string
  account_number: string
  qr_path: string | null
  active: boolean
  updated_by: string | null
  created_at: string
  updated_at: string
}

export type PaymentSubmissionStatus = 'pending' | 'approved' | 'rejected'

/** A borrower's e-wallet receipt awaiting (or after) cashier review. */
export interface PaymentSubmission {
  id: string
  application_id: string
  user_id: string
  channel_id: string | null
  provider: EwalletProvider
  amount: number
  reference: string
  proof_path: string
  status: PaymentSubmissionStatus
  submitted_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  review_note: string | null
  payment_id: string | null
}

export type CollateralStatus = 'offered' | 'received' | 'returned'

/** ATM card offered as collateral. Only the last 4 digits are stored — never the full number or PIN. */
export interface LoanCollateral {
  application_id: string
  user_id: string
  kind: 'atm_card'
  bank_name: string
  card_last4: string
  cardholder: string
  status: CollateralStatus
  created_at: string
  received_at: string | null
  received_by: string | null
  storage_ref: string | null
  returned_at: string | null
  returned_by: string | null
  return_note: string | null
}
