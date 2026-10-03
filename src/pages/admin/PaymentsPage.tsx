import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase.ts'
import { useAuth } from '../../auth/auth-context.ts'
import { unwrap, useQuery } from '../../hooks/useQuery.ts'
import { formatMoney } from '../../lib/loan.ts'
import { formatDateTime } from '../../lib/staff.ts'
import { PROVIDER_LABELS, paymentQrUrl, uploadPaymentQr } from '../../lib/payments.ts'
import type {
  EwalletProvider,
  PaymentChannel,
  PaymentSubmission,
  PaymentSubmissionStatus,
  Profile,
} from '../../lib/types.ts'
import { Card } from '../../components/Card.tsx'
import { Button } from '../../components/Button.tsx'
import { Loader } from '../../components/Loader.tsx'
import { StatusPill } from '../../components/StatusPill.tsx'
import { ChevronRightIcon } from '../../components/icons.tsx'

type QueueRow = PaymentSubmission & { profile: Pick<Profile, 'full_name'> | null }

const VIEWS: { key: PaymentSubmissionStatus | 'all'; label: string }[] = [
  { key: 'pending', label: 'To check' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
]

/** E-wallet receipts submitted by borrowers (cashiers and admins), plus receiving accounts (admins). */
export function PaymentsPage() {
  const { role } = useAuth()
  const [view, setView] = useState<PaymentSubmissionStatus | 'all'>('pending')
  const { data, error, loading } = useQuery(
    async () =>
      unwrap(
        await supabase
          .from('payment_submissions')
          .select('*, profile:profiles(full_name)')
          .order('submitted_at', { ascending: false })
          .limit(500),
      ) as QueueRow[],
    [],
  )

  const all = data ?? []
  // Oldest first while checking, so nobody waits longest; newest first otherwise.
  const rows = all.filter((r) => view === 'all' || r.status === view)
  if (view === 'pending') rows.reverse()

  return (
    <div className="stack-lg">
      <div className="stack">
        <h1 className="h1">E-wallet payments</h1>
        <p className="muted small">
          Borrowers' GCash and Maya receipts. Open one to check it against the e-wallet's transaction history, then
          approve or reject it on the loan page.
        </p>
      </div>

      <div className="chips" role="tablist">
        {VIEWS.map((v) => (
          <button key={v.key} role="tab" aria-selected={v.key === view} className="chip" onClick={() => setView(v.key)}>
            {v.label}
            <span className="chip__count">{all.filter((r) => v.key === 'all' || r.status === v.key).length}</span>
          </button>
        ))}
      </div>

      {error && <p className="alert alert--error">{error}</p>}
      {loading ? (
        <Loader label="Loading payments" />
      ) : rows.length === 0 ? (
        <Card className="empty">
          <p className="muted">{view === 'pending' ? 'No payments waiting to be checked. 🎉' : 'No payments here.'}</p>
        </Card>
      ) : (
        <div className="stack">
          {rows.map((r) => (
            <Link key={r.id} to={`/admin/applications/${r.application_id}`} className="loan-row-link">
              <Card interactive className="loan-row">
                <div className="loan-row__main">
                  <strong>
                    {formatMoney(Number(r.amount))} · {r.profile?.full_name || 'Unnamed borrower'}
                  </strong>
                  <span className="muted small">
                    {PROVIDER_LABELS[r.provider]} · Ref {r.reference} · {formatDateTime(r.submitted_at)}
                  </span>
                </div>
                <StatusPill status={r.status} />
                <ChevronRightIcon />
              </Card>
            </Link>
          ))}
        </div>
      )}

      {role === 'admin' && <ChannelsCard />}
    </div>
  )
}

/** Witik's receiving GCash/Maya accounts shown to borrowers. Admins only. */
function ChannelsCard() {
  const [editing, setEditing] = useState<PaymentChannel | 'new' | null>(null)
  const { data, error, reload } = useQuery(
    async () =>
      unwrap(await supabase.from('payment_channels').select('*').order('created_at')) as PaymentChannel[],
    [],
  )

  return (
    <Card className="stack">
      <div className="section-head">
        <h2 className="h3">Receiving accounts</h2>
        {!editing && (
          <Button variant="ghost" onClick={() => setEditing('new')}>
            Add account
          </Button>
        )}
      </div>
      <p className="muted small">
        Borrowers send payments to these accounts. Use Witik's own business e-wallet accounts, never a staff member's
        personal one.
      </p>
      {error && <p className="alert alert--error">{error}</p>}

      {editing && (
        <ChannelForm
          key={editing === 'new' ? 'new' : editing.id}
          existing={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await reload()
          }}
        />
      )}

      {data && data.length === 0 && !editing && <p className="muted small">No accounts yet, so borrowers can't pay by e-wallet.</p>}
      {data && data.length > 0 && (
        <ul className="plain-list">
          {data.map((c) => (
            <li key={c.id} className={c.active ? undefined : 'is-inactive'}>
              <span className="stack-xs">
                <strong>
                  {PROVIDER_LABELS[c.provider]} · {c.account_number}
                </strong>
                <span className="muted small">
                  {c.account_name}
                  {c.qr_path ? ' · QR code' : ''}
                  {c.active ? '' : ' · hidden from borrowers'}
                </span>
              </span>
              <button type="button" className="link small" onClick={() => setEditing(c)}>
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ChannelForm({
  existing,
  onCancel,
  onSaved,
}: {
  existing: PaymentChannel | null
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const [provider, setProvider] = useState<EwalletProvider>(existing?.provider ?? 'gcash')
  const [accountName, setAccountName] = useState(existing?.account_name ?? '')
  const [accountNumber, setAccountNumber] = useState(existing?.account_number ?? '')
  const [qrPath, setQrPath] = useState<string | null>(existing?.qr_path ?? null)
  const [qrFile, setQrFile] = useState<File | null>(null)
  const [active, setActive] = useState(existing?.active ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const path = qrFile ? await uploadPaymentQr(qrFile) : qrPath
      const { error } = await supabase.rpc('admin_save_payment_channel', {
        p_id: existing?.id ?? null,
        p_provider: provider,
        p_account_name: accountName,
        p_account_number: accountNumber,
        p_qr_path: path,
        p_active: active,
      })
      if (error) throw new Error(error.message)
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack notes" onSubmit={handleSubmit}>
      <div className="grid-2">
        <label className="field">
          <span>E-wallet</span>
          <select className="input" value={provider} onChange={(e) => setProvider(e.target.value as EwalletProvider)}>
            <option value="gcash">GCash</option>
            <option value="maya">Maya</option>
          </select>
        </label>
        <label className="field">
          <span>Mobile / account number</span>
          <input
            className="input"
            inputMode="tel"
            maxLength={40}
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="0917 123 4567"
            required
          />
        </label>
      </div>
      <label className="field">
        <span>Account name (as shown in the e-wallet)</span>
        <input
          className="input"
          maxLength={120}
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          placeholder="WITIK LENDING CORP."
          required
        />
      </label>
      <label className="field">
        <span>QR code (optional)</span>
        <input
          className="input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setQrFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {qrPath && !qrFile && (
        <div className="inline-form">
          <img src={paymentQrUrl(qrPath)} alt="Current QR code" width={96} height={96} />
          <button type="button" className="link small" onClick={() => setQrPath(null)}>
            Remove QR code
          </button>
        </div>
      )}
      <label className="checkbox">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span>Show to borrowers</span>
      </label>
      {error && <p className="alert alert--error">{error}</p>}
      <div className="button-row">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          Save account
        </Button>
      </div>
    </form>
  )
}
