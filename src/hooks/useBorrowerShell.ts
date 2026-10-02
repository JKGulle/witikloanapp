import { useOutletContext } from 'react-router-dom'
import type { KycStatus } from '../lib/types.ts'

export interface BorrowerShellContext {
  kycStatus: KycStatus | null
  refreshProfile: () => Promise<void>
}

/** Borrower pages can read the signed-in borrower's verification status from the shell. */
export const useBorrowerShell = () => useOutletContext<BorrowerShellContext>()
