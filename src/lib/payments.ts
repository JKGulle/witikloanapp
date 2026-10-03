import { supabase } from './supabase.ts'
import { compressImage } from './kyc.ts'
import type { EwalletProvider } from './types.ts'

/** Public bucket for Witik's receiving QR codes; admins upload. */
export const PAYMENT_QR_BUCKET = 'payment-qr'
/** Private bucket for borrowers' receipts; access is enforced by storage policies. */
export const PAYMENT_PROOF_BUCKET = 'payment-proofs'

export const PROVIDER_LABELS: Record<EwalletProvider, string> = {
  gcash: 'GCash',
  maya: 'Maya',
}

/** Public URL of a channel's QR code. */
export const paymentQrUrl = (path: string) => supabase.storage.from(PAYMENT_QR_BUCKET).getPublicUrl(path).data.publicUrl

async function currentUserId(): Promise<string> {
  // Ask the server, as for KYC uploads: Storage checks the folder against the id it sees.
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) {
    throw new Error('Your session has expired. Please sign in again, then retry the upload.')
  }
  return data.user.id
}

/** Uploads a receipt screenshot into the signed-in borrower's own folder and returns its path. */
export async function uploadPaymentProof(file: File): Promise<string> {
  const owner = await currentUserId()
  const blob = await compressImage(file)
  const path = `${owner}/receipt-${Date.now()}.jpg`
  const { error } = await supabase.storage.from(PAYMENT_PROOF_BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw new Error(`Upload failed: ${error.message}`)
  return path
}

/**
 * Uploads a QR code (admins). Kept as PNG and not resized, since recompressing a QR
 * code can make it unscannable.
 */
export async function uploadPaymentQr(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Use a PNG or JPG image of the QR code.')
  }
  if (file.size > 2 * 1024 * 1024) throw new Error('The QR image must be 2 MB or smaller.')
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `qr-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(PAYMENT_QR_BUCKET).upload(path, file, { contentType: file.type })
  if (error) throw new Error(`Upload failed: ${error.message}`)
  return path
}

/** Short-lived signed URLs for receipts, keyed by path; storage policies decide who may see them. */
export async function signedProofUrls(paths: string[], expiresIn = 600): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map()
  const { data } = await supabase.storage.from(PAYMENT_PROOF_BUCKET).createSignedUrls(paths, expiresIn)
  return new Map((data ?? []).flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])))
}
