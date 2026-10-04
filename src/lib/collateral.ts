import { supabase } from './supabase.ts'
import type { CollateralStatus } from './types.ts'

/** Common issuers in the Philippines; borrowers can still type any bank. */
export const BANKS = [
  'BDO',
  'BPI',
  'Metrobank',
  'Landbank',
  'PNB',
  'Security Bank',
  'UnionBank',
  'RCBC',
  'China Bank',
  'EastWest',
  'DBP',
  'PSBank',
]

/** What the borrower tells us about the card. Never the full number or the PIN. */
export interface AtmCardInput {
  bank: string
  last4: string
  cardholder: string
}

export const emptyAtmCard = (cardholder = ''): AtmCardInput => ({ bank: '', last4: '', cardholder })

export const isAtmCardComplete = (c: AtmCardInput) =>
  c.bank.trim().length >= 2 && /^\d{4}$/.test(c.last4) && c.cardholder.trim().length >= 2

export async function offerAtmCollateral(applicationId: string, card: AtmCardInput) {
  const { error } = await supabase.rpc('offer_atm_collateral', {
    p_application_id: applicationId,
    p_bank_name: card.bank,
    p_card_last4: card.last4,
    p_cardholder: card.cardholder,
  })
  if (error) throw new Error(error.message)
}

export const COLLATERAL_LABELS: Record<CollateralStatus, string> = {
  offered: 'To hand in',
  received: 'Held by Witik',
  returned: 'Returned',
}

/** Reuses the loan status pill colours. */
export const COLLATERAL_PILL: Record<CollateralStatus, string> = {
  offered: 'pending',
  received: 'approved',
  returned: 'paid',
}
