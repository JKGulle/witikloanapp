import { useState } from 'react'
import { supabase } from '../lib/supabase.ts'
import { unwrap, useQuery } from '../hooks/useQuery.ts'
import { formatMoney } from '../lib/loan.ts'
import { formatDateTime } from '../lib/staff.ts'
import { PROVIDER_LABELS, signedProofUrls } from '../lib/payments.ts'
import type { PaymentSubmission } from '../lib/types.ts'
import { Button } from './Button.tsx'

/** Cashier check of a loan's pending e-wallet receipts: approve (records the payment) or reject. */
export function PaymentSubmissionReview({
  applicationId,
  onReviewed,
}: {
  applicationId: string
  onReviewed: (message: string) => Promise<void>
}) {
  const { data, error, reload } = useQuery(async () => {
    const rows = unwrap(
      await supabase
        .from('payment_submissions')
        .select('*')
        .eq('application_id', applicationId)
        .eq('status', 'pending')
        .order('submitted_at'),
    ) as PaymentSubmission[]
    return { rows, proofs: await signedProofUrls(rows.map((r) => r.proof_path)) }
  }, [applicationId])

  if (error) return <p className="alert alert--error">{error}</p>
  if (!data || data.rows.length === 0) return null

  return (
    <div className="stack">
      <h3 className="h3">E-wallet payments to check ({data.rows.length})</h3>
      <p className="muted small">
        Find each reference number in Witik's e-wallet transaction history and check the amount and sender before
        approving. Approved payments count from the time the borrower submitted them.
      </p>
      {data.rows.map((s) => (
        <SubmissionRow
          key={s.id}
          submission={s}
          proofUrl={data.proofs.get(s.proof_path) ?? null}
          onReviewed={async (message) => {
            await reload()
            await onReviewed(message)
          }}
        />
      ))}
    </div>
  )
}

function SubmissionRow({
  submission: s,
  proofUrl,
  onReviewed,
}: {
  submission: PaymentSubmission
  proofUrl: string | null
  onReviewed: (message: string) => Promise<void>
}) {
  const [amount, setAmount] = useState(Number(s.amount).toFixed(2))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const changed = Math.abs(Number(amount) - Number(s.amount)) > 0.005

  async function decide(decision: 'approved' | 'rejected') {
    const prompt =
      decision === 'approved'
        ? `Confirm ${formatMoney(Number(amount))} arrived in ${PROVIDER_LABELS[s.provider]} with reference ${s.reference}?`
        : 'Reject this payment? The borrower will see your reason.'
    if (!window.confirm(prompt)) return
    setBusy(decision)
    setError(null)
    const { error } = await supabase.rpc('review_payment_submission', {
      p_submission_id: s.id,
      p_decision: decision,
      p_amount: decision === 'approved' ? Number(amount) : null,
      p_note: note,
    })
    setBusy(null)
    if (error) return setError(error.message)
    await onReviewed(decision === 'approved' ? 'E-wallet payment approved and recorded.' : 'E-wallet payment rejected.')
  }

  return (
    <div className="proof-row">
      {proofUrl ? (
        <a href={proofUrl} target="_blank" rel="noreferrer" className="kyc-thumb">
          <img src={proofUrl} alt="Payment receipt" loading="lazy" />
          <span>Open receipt</span>
        </a>
      ) : (
        <span className="muted small">Receipt unavailable</span>
      )}
      <div className="proof-row__body stack">
        <dl className="kv">
          <dt>Claimed</dt>
          <dd>
            <strong>{formatMoney(Number(s.amount))}</strong> via {PROVIDER_LABELS[s.provider]}
          </dd>
          <dt>Reference</dt>
          <dd>{s.reference}</dd>
          <dt>Submitted</dt>
          <dd>{formatDateTime(s.submitted_at)}</dd>
        </dl>
        <div className="grid-2">
          <label className="field">
            <span>Amount received</span>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Note (required to reject; shown to the borrower)</span>
            <input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        {changed && (
          <p className="alert alert--warning">
            You're recording a different amount from what the borrower entered. Add a note explaining why.
          </p>
        )}
        {error && <p className="alert alert--error">{error}</p>}
        <div className="button-row">
          <Button
            loading={busy === 'approved'}
            disabled={!!busy || !(Number(amount) > 0) || (changed && !note.trim())}
            onClick={() => void decide('approved')}
          >
            Approve
          </Button>
          <Button
            variant="danger"
            loading={busy === 'rejected'}
            disabled={!!busy || !note.trim()}
            onClick={() => void decide('rejected')}
          >
            Reject
          </Button>
        </div>
      </div>
    </div>
  )
}
