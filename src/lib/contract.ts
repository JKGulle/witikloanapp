/**
 * Loan contract. The text is in components/LoanContract.tsx; this file holds its version and the
 * lender details it quotes.
 *
 * ⚠️ Have a lawyer review the contract before going live, and fill in LENDER below.
 * When the wording changes, bump CONTRACT_VERSION here AND public.loan_contract_version() in a new
 * migration: every loan not yet released will then ask the borrower to accept the new version.
 */
export const CONTRACT_VERSION = 'v1'

/** Shown in the contract. Replace every [bracketed] placeholder with the registered details. */
export const LENDER = {
  name: '[REGISTERED COMPANY NAME]',
  tradeName: 'Witik Loan',
  secRegistration: '[SEC REGISTRATION NO.]',
  certificateOfAuthority: '[CERTIFICATE OF AUTHORITY NO.]',
  address: '[REGISTERED OFFICE ADDRESS]',
  email: '[SUPPORT EMAIL]',
  venue: '[CITY]',
}

/** True while any lender detail is still a placeholder (shown as a warning to staff). */
export const lenderDetailsIncomplete = Object.values(LENDER).some((v) => v.startsWith('['))

/** Whether a not-yet-released loan still needs the borrower to accept the current contract terms. */
export function needsContractAcceptance(app: {
  status: string
  contract_version: string | null
  contract_rate: number | string | null
  annual_rate: number | string
}) {
  if (app.status !== 'pending' && app.status !== 'approved') return false
  return app.contract_version !== CONTRACT_VERSION || Number(app.contract_rate) !== Number(app.annual_rate)
}
