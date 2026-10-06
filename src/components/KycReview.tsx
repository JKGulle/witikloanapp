import { useState } from 'react'
import { supabase } from '../lib/supabase.ts'
import { unwrap, useQuery } from '../hooks/useQuery.ts'
import { idTypeLabel, signedKycImages } from '../lib/kyc.ts'
import { formatDateTime } from '../lib/staff.ts'
import type { KycStatus, KycSubmission } from '../lib/types.ts'
import { Button } from './Button.tsx'
import { KycThumbnails } from './KycThumbnails.tsx'

/** Staff view of a borrower's KYC documents, with verify / reject actions. */
export function KycReview({
  userId,
  status,
  canReview,
  onChanged,
}: {
  userId: string
  status: KycStatus
  canReview: boolean
  onChanged: () => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<'verified' | 'rejected' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data, loading, reload } = useQuery(async () => {
    const submission = unwrap(
      await supabase.from('kyc_submissions').select('*').eq('user_id', userId).maybeSingle(),
    ) as KycSubmission | null
    return { submission, images: submission ? await signedKycImages(submission) : null }
  }, [userId])

  async function decide(next: 'verified' | 'rejected') {
    if (next === 'verified' && !data?.submission && !window.confirm('No documents were uploaded. Verify anyway?')) return
    setBusy(next)
    setError(null)
    const { error } = await supabase.rpc('set_kyc_status', {
      p_user_id: userId,
      p_status: next,
      p_note: next === 'rejected' ? reason : null,
      // Refused by the database if the borrower replaced the documents after they were loaded here.
      p_submitted_at: data?.submission?.submitted_at ?? null,
    })
    setBusy(null)
    if (error) return setError(error.message)
    setReason('')
    await Promise.all([reload(), onChanged()])
  }

  const submission = data?.submission

  return (
    <div className="stack kyc-review">
      <h3 className="eyebrow">Identity documents</h3>
      {loading ? (
        <p className="muted small">Loading documents…</p>
      ) : !submission ? (
        <p className="muted small">The borrower hasn't uploaded an ID yet.</p>
      ) : (
        <>
          <p className="muted small">
            {idTypeLabel(submission.id_type)} · submitted {formatDateTime(submission.submitted_at)}
          </p>
          {data?.images && <KycThumbnails images={data.images} />}
          {submission.review_note && <p className="notes small">Last review: {submission.review_note}</p>}
        </>
      )}

      {error && <p className="alert alert--error">{error}</p>}

      {canReview && (
        <div className="stack">
          <input
            className="input"
            placeholder="Reason, if rejecting (shown to the borrower)"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="button-row">
            <Button
              variant="ghost"
              loading={busy === 'verified'}
              disabled={status === 'verified'}
              onClick={() => void decide('verified')}
            >
              Verify KYC
            </Button>
            <Button
              variant="danger"
              loading={busy === 'rejected'}
              disabled={!reason.trim() || status === 'rejected'}
              onClick={() => void decide('rejected')}
            >
              Reject KYC
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
