import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase.ts'
import { unwrap, useQuery } from '../hooks/useQuery.ts'
import { formatMoney } from '../lib/loan.ts'
import { formatDateTime } from '../lib/staff.ts'
import { PROVIDER_LABELS, paymentQrUrl, uploadPaymentProof } from '../lib/payments.ts'
import type { PaymentChannel, PaymentSubmission } from '../lib/types.ts'
import { Card } from './Card.tsx'
import { Button } from './Button.tsx'
import { StatusPill } from './StatusPill.tsx'
import { KycUploadTile } from './KycUploadTile.tsx'

/**
 * Borrower pays to Witik's GCash/Maya account, then submits the reference number and a
 * receipt screenshot. A cashier checks it before it counts as a payment.
 */
export function EwalletPayCard({
  applicationId,
  suggested,
  owed,
  onSubmitted,
}: {
  applicationId: string
  /** Amount to pay now (next installment or overdue amount, plus penalties). */
  suggested: number
  /** Everything still owed, including penalties. */
  owed: number
  onSubmitted: () => void
}) {
  const [open, setOpen] = useState(false)
  const { data, error, reload } = useQuery(async () => {
    const [channels, submissions] = await Promise.all([
      supabase.from('payment_channels').select('*').eq('active', true).order('created_at'),
      supabase
        .from('payment_submissions')
        .select('*')
        .eq('application_id', applicationId)
        .order('submitted_at', { ascending: false }),
    ])
    return {
      channels: unwrap(channels) as PaymentChannel[],
      submissions: unwrap(submissions) as PaymentSubmission[],
    }
  }, [applicationId])

  const channels = data?.channels ?? []
  // Approved ones already show under Payments; keep pending and rejected here.
  const submissions = (data?.submissions ?? []).filter((s) => s.status !== 'approved')
  const pendingTotal = submissions.filter((s) => s.status === 'pending').reduce((sum, s) => sum + Number(s.amount), 0)
  const remaining = Math.max(Math.round((owed - pendingTotal) * 100) / 100, 0)

  return (
    <Card className="stack">
      <div className="section-head">
        <h2 className="h3">Pay with GCash or Maya</h2>
      </div>

      {error && <p className="alert alert--error">{error}</p>}

      {data && channels.length === 0 && (
        <p className="muted small">E-wallet payments aren't available yet. Please pay a Witik cashier for now.</p>
      )}

      {channels.length > 0 && !open && (
        <>
          <p className="muted small">
            Send your payment from your e-wallet app, then upload the receipt here. A cashier checks it, usually within
            one business day. It counts from the time you submit it, so you won't be charged a penalty while it's being
            checked.
          </p>
          {remaining > 0.005 ? (
            <Button onClick={() => setOpen(true)}>Pay {formatMoney(Math.min(suggested, remaining))}</Button>
          ) : (
            <p className="alert alert--info">Your remaining balance is covered by payments awaiting review.</p>
          )}
        </>
      )}

      {channels.length > 0 && open && (
        <PayForm
          applicationId={applicationId}
          channels={channels}
          suggested={Math.min(suggested, remaining)}
          max={remaining}
          onCancel={() => setOpen(false)}
          onDone={async () => {
            setOpen(false)
            await reload()
            onSubmitted()
          }}
        />
      )}

      {submissions.length > 0 && (
        <ul className="plain-list">
          {submissions.map((s) => (
            <li key={s.id}>
              <span className="stack-xs">
                <strong>{formatMoney(Number(s.amount))}</strong>
                <span className="muted small">
                  {PROVIDER_LABELS[s.provider]} · Ref {s.reference} · {formatDateTime(s.submitted_at)}
                </span>
                {s.status === 'rejected' && s.review_note && (
                  <span className="text-danger small">Not accepted: {s.review_note}</span>
                )}
              </span>
              <StatusPill status={s.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function PayForm({
  applicationId,
  channels,
  suggested,
  max,
  onCancel,
  onDone,
}: {
  applicationId: string
  channels: PaymentChannel[]
  suggested: number
  max: number
  onCancel: () => void
  onDone: () => Promise<void>
}) {
  const [channelId, setChannelId] = useState(channels[0].id)
  const [amount, setAmount] = useState(suggested.toFixed(2))
  const [reference, setReference] = useState('')
  const [receipt, setReceipt] = useState<File | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const channel = channels.find((c) => c.id === channelId) ?? channels[0]

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(channel.account_number.replace(/\s/g, ''))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked; the number is on screen to type in.
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!receipt) return
    setError(null)
    try {
      setProgress('Uploading receipt…')
      const path = await uploadPaymentProof(receipt)
      setProgress('Submitting…')
      const { error } = await supabase.rpc('submit_payment_proof', {
        p_application_id: applicationId,
        p_channel_id: channel.id,
        p_amount: Number(amount),
        p_reference: reference,
        p_proof_path: path,
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
      {channels.length > 1 && (
        <div className="chips" role="tablist" aria-label="E-wallet">
          {channels.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === channel.id}
              className="chip"
              onClick={() => setChannelId(c.id)}
            >
              {PROVIDER_LABELS[c.provider]}
            </button>
          ))}
        </div>
      )}

      <div className="pay-channel">
        {channel.qr_path && (
          <a href={paymentQrUrl(channel.qr_path)} target="_blank" rel="noreferrer" className="pay-channel__qr">
            <img src={paymentQrUrl(channel.qr_path)} alt={`${PROVIDER_LABELS[channel.provider]} QR code`} />
          </a>
        )}
        <dl className="kv">
          <dt>Send to</dt>
          <dd>{PROVIDER_LABELS[channel.provider]}</dd>
          <dt>Account name</dt>
          <dd>{channel.account_name}</dd>
          <dt>Number</dt>
          <dd>
            <strong>{channel.account_number}</strong>{' '}
            <button type="button" className="link small" onClick={() => void copyNumber()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </dd>
        </dl>
      </div>
      <p className="muted small">
        1. Open {PROVIDER_LABELS[channel.provider]} and {channel.qr_path ? 'scan the QR code or ' : ''}send to the number
        above. Check that the account name matches. 2. Screenshot the receipt. 3. Fill in the details below.
      </p>

      <div className="grid-2">
        <label className="field">
          <span>Amount you sent</span>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            min="1"
            max={max.toFixed(2)}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Reference number</span>
          <input
            className="input"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="From your e-wallet receipt"
            minLength={4}
            maxLength={60}
            autoComplete="off"
            required
          />
        </label>
      </div>

      <div className="upload-grid">
        <KycUploadTile
          label="Receipt screenshot"
          hint="Amount, reference number and date must be visible"
          file={receipt}
          onChange={setReceipt}
        />
      </div>

      {error && <p className="alert alert--error">{error}</p>}
      <div className="button-row">
        <Button variant="ghost" onClick={onCancel} disabled={!!progress}>
          Cancel
        </Button>
        <Button type="submit" loading={!!progress} disabled={!receipt || !reference.trim()}>
          Submit payment
        </Button>
      </div>
      {progress && (
        <p className="muted small" aria-live="polite">
          {progress}
        </p>
      )}
    </form>
  )
}
