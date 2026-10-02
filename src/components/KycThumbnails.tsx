import type { KycImages } from '../lib/kyc.ts'

const SLOTS: { key: keyof KycImages; label: string }[] = [
  { key: 'idFront', label: 'ID front' },
  { key: 'idBack', label: 'ID back' },
  { key: 'selfie', label: 'Selfie' },
]

/** Clickable previews of KYC photos; each opens full-size in a new tab. */
export function KycThumbnails({ images }: { images: KycImages }) {
  return (
    <div className="kyc-thumbs">
      {SLOTS.filter((s) => images[s.key]).map((s) => (
        <a key={s.key} href={images[s.key]!} target="_blank" rel="noreferrer" className="kyc-thumb">
          <img src={images[s.key]!} alt={s.label} loading="lazy" />
          <span>{s.label}</span>
        </a>
      ))}
    </div>
  )
}
