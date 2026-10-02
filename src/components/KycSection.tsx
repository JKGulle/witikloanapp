import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase.ts'
import { unwrap, useQuery } from '../hooks/useQuery.ts'
import { ID_TYPES, idTypeLabel, signedKycImages, uploadKycDocument } from '../lib/kyc.ts'
import { formatDateTime } from '../lib/staff.ts'
import type { IdType, KycStatus, KycSubmission } from '../lib/types.ts'
import { Card } from './Card.tsx'
import { Button } from './Button.tsx'
import { StatusPill } from './StatusPill.tsx'
import { KycUploadTile } from './KycUploadTile.tsx'
import { KycThumbnails } from './KycThumbnails.tsx'
import { VerifiedBadge } from './VerifiedBadge.tsx'

/** Borrower-facing identity verification: upload a government ID and a selfie. */
export function KycSection({
  userId,
  status,
  onSubmitted,
}: {
  userId: string
  status: KycStatus
  onSubmitted: () => void
}) {
  const [replacing, setReplacing] = useState(false)
  const { data, reload } = useQuery(async () => {
    const submission = unwrap(
      await supabase.from('kyc_submissions').select('*').eq('user_id', userId).maybeSingle(),
    ) as KycSubmission | null
    const images = submission ? await signedKycImages(submission) : null
    return { submission, images }
  }, [userId])

  const submission = data?.submission ?? null
  const showForm = status === 'unverified' || status === 'rejected' || replacing

  return (
    <Card className="stack">
      <div className="section-head">
        <h2 className="h3">Identity verification</h2>
        <StatusPill status={status} />
      </div>

      {status === 'verified' && (
        <p className="alert alert--info verified-note">
          <VerifiedBadge size="md" /> Your identity is verified. Thank you!
        </p>
      )}

      {status === 'rejected' && submission?.review_note && (
        <p className="alert alert--error">
          We couldn't verify your documents: {submission.review_note}. Please upload new photos.
        </p>
      )}

      {status === 'pending' && submission && !replacing && (
        <>
          <p className="muted small">
            {idTypeLabel(submission.id_type)} submitted {formatDateTime(submission.submitted_at)}. We'll review it
            shortly.
          </p>
          {data?.images && <KycThumbnails images={data.images} />}
          <Button variant="ghost" onClick={() => setReplacing(true)}>
            Replace documents
          </Button>
        </>
      )}

      {showForm && (
        <KycForm
          onCancel={replacing ? () => setReplacing(false) : undefined}
          onDone={async () => {
            setReplacing(false)
            await reload()
            onSubmitted()
          }}
        />
      )}
    </Card>
  )
}

function KycForm({ onCancel, onDone }: { onCancel?: () => void; onDone: () => Promise<void> }) {
  const [idType, setIdType] = useState<IdType>('philsys')
  const [front, setFront] = useState<File | null>(null)
  const [back, setBack] = useState<File | null>(null)
  const [selfie, setSelfie] = useState<File | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasBack = ID_TYPES.find((t) => t.value === idType)?.hasBack ?? true

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!front || !selfie) return
    setError(null)
    try {
      const files = [
        ['id_front', front],
        ...(hasBack && back ? [['id_back', back] as const] : []),
        ['selfie', selfie],
      ] as const
      const paths: Record<string, string> = {}
      for (const [i, [kind, file]] of files.entries()) {
        setProgress(`Uploading ${i + 1} of ${files.length}…`)
        paths[kind] = await uploadKycDocument(kind, file)
      }
      setProgress('Submitting…')
      const { error } = await supabase.rpc('submit_kyc', {
        p_id_type: idType,
        p_id_front_path: paths.id_front,
        p_id_back_path: paths.id_back ?? null,
        p_selfie_path: paths.selfie,
      })
      if (error) throw new Error(error.message)
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProgress(null)
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <p className="muted small">
        Upload a valid government ID and a selfie of you holding it. Make sure all four corners are visible and the
        text is readable. Only Witik staff reviewing your application can see these photos.
      </p>
      <label className="field">
        <span>ID type</span>
        <select className="input" value={idType} onChange={(e) => setIdType(e.target.value as IdType)}>
          {ID_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <div className="upload-grid">
        <KycUploadTile
          label={hasBack ? 'Front of ID' : 'Photo page'}
          hint="Flat surface, no glare"
          file={front}
          onChange={setFront}
        />
        {hasBack && (
          <KycUploadTile label="Back of ID" hint="Include if your ID has details on the back" file={back} onChange={setBack} optional />
        )}
        <KycUploadTile
          label="Selfie with ID"
          hint="Hold the ID next to your face"
          file={selfie}
          onChange={setSelfie}
          capture="user"
        />
      </div>
      {error && <p className="alert alert--error">{error}</p>}
      <div className="button-row">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={!!progress}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={!!progress} disabled={!front || !selfie}>
          Submit for verification
        </Button>
      </div>
      {progress && <p className="muted small" aria-live="polite">{progress}</p>}
    </form>
  )
}
