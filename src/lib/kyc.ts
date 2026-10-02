import { supabase } from './supabase.ts'
import type { IdType, KycSubmission } from './types.ts'

/** Private bucket; access is enforced by storage policies in the KYC migration. */
export const KYC_BUCKET = 'kyc-documents'

export const ID_TYPES: { value: IdType; label: string; hasBack: boolean }[] = [
  { value: 'philsys', label: 'PhilSys National ID', hasBack: true },
  { value: 'passport', label: 'Passport', hasBack: false },
  { value: 'drivers_license', label: "Driver's License", hasBack: true },
  { value: 'umid', label: 'UMID', hasBack: true },
  { value: 'sss', label: 'SSS ID', hasBack: true },
  { value: 'prc', label: 'PRC ID', hasBack: true },
  { value: 'postal', label: 'Postal ID', hasBack: true },
  { value: 'voters', label: "Voter's ID", hasBack: true },
]

export const idTypeLabel = (t: IdType) => ID_TYPES.find((i) => i.value === t)?.label ?? t

export type KycDocKind = 'id_front' | 'id_back' | 'selfie'

const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.85
const MAX_BYTES = 5 * 1024 * 1024

/**
 * Downscales a photo to at most 1600px and re-encodes it as JPEG, which keeps
 * uploads small on mobile data and strips most camera metadata (GPS etc.).
 */
export async function compressImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('This photo format is not supported. Please use a JPG or PNG photo.')
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob) throw new Error('Could not process the photo. Please try another one.')
  if (blob.size > MAX_BYTES) throw new Error('This photo is too large. Please use a smaller one.')
  return blob
}

/** Uploads one document into the signed-in user's own folder and returns its storage path. */
export async function uploadKycDocument(userId: string, kind: KycDocKind, file: File): Promise<string> {
  const blob = await compressImage(file)
  const path = `${userId}/${kind}-${Date.now()}.jpg`
  const { error } = await supabase.storage.from(KYC_BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw new Error(error.message)
  return path
}

export interface KycImages {
  idFront: string | null
  idBack: string | null
  selfie: string | null
}

/** Short-lived signed URLs; storage policies decide whether the viewer may see them. */
export async function signedKycImages(submission: KycSubmission, expiresIn = 600): Promise<KycImages> {
  const paths = [submission.id_front_path, submission.id_back_path, submission.selfie_path]
  const urls = await Promise.all(
    paths.map(async (path) => {
      if (!path) return null
      const { data } = await supabase.storage.from(KYC_BUCKET).createSignedUrl(path, expiresIn)
      return data?.signedUrl ?? null
    }),
  )
  return { idFront: urls[0], idBack: urls[1], selfie: urls[2] }
}
