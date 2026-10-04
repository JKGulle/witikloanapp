import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase.ts'
import { unwrap, useQuery } from '../hooks/useQuery.ts'
import { formatDate } from '../lib/loan.ts'
import type { LoanCollateral, LoanStatus } from '../lib/types.ts'
import {
  BANKS,
  COLLATERAL_LABELS,
  COLLATERAL_PILL,
  emptyAtmCard,
  isAtmCardComplete,
  offerAtmCollateral,
  type AtmCardInput,
} from '../lib/collateral.ts'
import { Card } from './Card.tsx'
import { Button } from './Button.tsx'

/** Shown wherever a borrower is asked about their card. */
export function PinWarning() {
  return (
    <p className="alert alert--warning">
      Never share your ATM PIN or full card number with anyone, including Witik staff. We will never ask for them.
    </p>
  )
}

/** Bank, last 4 digits and name on card. */
export function AtmCardFields({ value, onChange }: { value: AtmCardInput; onChange: (v: AtmCardInput) => void }) {
  return (
    <div className="stack">
      <div className="grid-2">
        <label className="field">
          <span>Bank</span>
          <input
            className="input"
            list="atm-banks"
            maxLength={80}
            value={value.bank}
            onChange={(e) => onChange({ ...value, bank: e.target.value })}
            placeholder="e.g. BDO"
            required
          />
          <datalist id="atm-banks">
            {BANKS.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Last 4 digits of the card</span>
          <input
            className="input"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]{4}"
            maxLength={4}
            value={value.last4}
            onChange={(e) => onChange({ ...value, last4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            placeholder="1234"
            required
          />
        </label>
      </div>
      <label className="field">
        <span>Name on the card</span>
        <input
          className="input"
          maxLength={120}
          value={value.cardholder}
          onChange={(e) => onChange({ ...value, cardholder: e.target.value })}
          required
        />
      </label>
    </div>
  )
}

/** Borrower's view of the ATM card collateral on one loan. */
export function BorrowerCollateralCard({
  applicationId,
  loanStatus,
  defaultName,
}: {
  applicationId: string
  loanStatus: LoanStatus
  defaultName: string
}) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data, loading, reload } = useQuery(
    async () =>
      unwrap(
        await supabase.from('loan_collateral').select('*').eq('application_id', applicationId).maybeSingle(),
      ) as LoanCollateral | null,
    [applicationId],
  )
  const [card, setCard] = useState<AtmCardInput | null>(null)

  if (loading) return null
  const collateral = data
  const pending = loanStatus === 'pending'
  // Nothing to show on loans that never had collateral, except the option to add it while pending.
  if (!collateral && !pending) return null

  function startEditing() {
    setCard(
      collateral
        ? { bank: collateral.bank_name, last4: collateral.card_last4, cardholder: collateral.cardholder }
        : emptyAtmCard(defaultName),
    )
    setError(null)
    setEditing(true)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!card) return
    setBusy(true)
    setError(null)
    try {
      await offerAtmCollateral(applicationId, card)
      setEditing(false)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    if (!window.confirm('Remove your ATM card as collateral for this loan?')) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('withdraw_atm_collateral', { p_application_id: applicationId })
    setBusy(false)
    if (error) return setError(error.message)
    await reload()
  }

  return (
    <Card className="stack">
      <div className="section-head">
        <h2 className="h3">ATM card collateral</h2>
        {collateral && <span className={`pill pill--${COLLATERAL_PILL[collateral.status]}`}>{COLLATERAL_LABELS[collateral.status]}</span>}
      </div>

      {editing && card ? (
        <form className="stack" onSubmit={handleSave}>
          <p className="muted small">
            You'll hand this card to a Witik cashier when your loan is released. It's returned when your loan is fully
            paid.
          </p>
          <AtmCardFields value={card} onChange={setCard} />
          <PinWarning />
          {error && <p className="alert alert--error">{error}</p>}
          <div className="button-row">
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!isAtmCardComplete(card)}>
              Save card
            </Button>
          </div>
        </form>
      ) : !collateral ? (
        <>
          <p className="muted small">
            Optional: offer your ATM card as collateral for this loan. You hand it in when the loan is released and get
            it back when it's fully paid.
          </p>
          <Button variant="ghost" onClick={startEditing}>
            Add ATM card
          </Button>
        </>
      ) : (
        <>
          <dl className="kv">
            <dt>Card</dt>
            <dd>
              {collateral.bank_name} •••• {collateral.card_last4}
            </dd>
            <dt>Name on card</dt>
            <dd>{collateral.cardholder}</dd>
            {collateral.received_at && (
              <>
                <dt>Handed in</dt>
                <dd>{formatDate(collateral.received_at)}</dd>
              </>
            )}
            {collateral.returned_at && (
              <>
                <dt>Returned</dt>
                <dd>{formatDate(collateral.returned_at)}</dd>
              </>
            )}
          </dl>
          {collateral.status === 'offered' && (
            <p className="muted small">
              {loanStatus === 'approved'
                ? 'Bring this card to the Witik office to receive your loan. The loan is released once the cashier has it.'
                : "Bring this card when your loan is released. It's returned when your loan is fully paid."}
            </p>
          )}
          {collateral.status === 'received' && (
            <p className="muted small">
              {loanStatus === 'paid'
                ? 'Your loan is paid off. Visit the Witik office to collect your card.'
                : 'Witik is holding your card. It will be returned when your loan is fully paid.'}
            </p>
          )}
          {collateral.status !== 'returned' && <PinWarning />}
          {error && <p className="alert alert--error">{error}</p>}
          {pending && collateral.status === 'offered' && (
            <div className="button-row">
              <Button variant="ghost" onClick={startEditing} disabled={busy}>
                Edit
              </Button>
              <Button variant="danger" onClick={() => void handleRemove()} loading={busy}>
                Remove
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

/** Staff view: card details, and for cashiers/admins the hand-in and hand-back steps. */
export function StaffCollateralCard({
  applicationId,
  collateral,
  loanStatus,
  canHandleCash,
  onChanged,
}: {
  applicationId: string
  collateral: LoanCollateral
  loanStatus: LoanStatus
  canHandleCash: boolean
  onChanged: (message: string) => Promise<void>
}) {
  const [storageRef, setStorageRef] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canReceive = canHandleCash && collateral.status === 'offered' && loanStatus === 'approved'
  // An approved loan that won't be released can hand the card back too; an active loan can't.
  const canReturn = canHandleCash && collateral.status === 'received' && loanStatus !== 'disbursed'
  const card = `${collateral.bank_name} •••• ${collateral.card_last4}`

  async function act(rpc: 'collateral_mark_received' | 'collateral_mark_returned', confirm: string, success: string) {
    if (!window.confirm(confirm)) return
    setBusy(true)
    setError(null)
    const { error } =
      rpc === 'collateral_mark_received'
        ? await supabase.rpc(rpc, { p_application_id: applicationId, p_storage_ref: storageRef })
        : await supabase.rpc(rpc, { p_application_id: applicationId, p_note: note })
    setBusy(false)
    if (error) return setError(error.message)
    await onChanged(success)
  }

  return (
    <Card className="stack">
      <div className="section-head">
        <h2 className="h3">ATM card collateral</h2>
        <span className={`pill pill--${COLLATERAL_PILL[collateral.status]}`}>{COLLATERAL_LABELS[collateral.status]}</span>
      </div>
      <dl className="kv">
        <dt>Card</dt>
        <dd>{card}</dd>
        <dt>Name on card</dt>
        <dd>{collateral.cardholder}</dd>
        {collateral.received_at && (
          <>
            <dt>Received</dt>
            <dd>
              {formatDate(collateral.received_at)}
              {collateral.storage_ref ? ` · stored at ${collateral.storage_ref}` : ''}
            </dd>
          </>
        )}
        {collateral.returned_at && (
          <>
            <dt>Returned</dt>
            <dd>
              {formatDate(collateral.returned_at)}
              {collateral.return_note ? ` · ${collateral.return_note}` : ''}
            </dd>
          </>
        )}
      </dl>

      {canReceive && (
        <>
          <p className="muted small">
            Check that the bank, last 4 digits and name match the card and the borrower's ID. Do not accept or write down
            the PIN. The loan can be released once the card is received.
          </p>
          <div className="inline-form">
            <input
              className="input"
              placeholder="Storage location (e.g. Envelope 0012, Safe A)"
              aria-label="Storage location"
              maxLength={80}
              value={storageRef}
              onChange={(e) => setStorageRef(e.target.value)}
            />
            <Button
              loading={busy}
              onClick={() => void act('collateral_mark_received', `Confirm you received ${card}?`, 'ATM card received.')}
            >
              Mark card received
            </Button>
          </div>
        </>
      )}
      {canHandleCash && collateral.status === 'offered' && loanStatus === 'pending' && (
        <p className="muted small">The card is handed in once the application is approved.</p>
      )}

      {canReturn && (
        <>
          {loanStatus === 'paid' ? (
            <p className="alert alert--info">This loan is paid off. Return the card to the borrower.</p>
          ) : (
            <p className="muted small">This loan hasn't been released. Return the card only if it won't be.</p>
          )}
          <div className="inline-form">
            <input
              className="input"
              placeholder="Note (optional, e.g. collected by borrower)"
              aria-label="Return note"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              variant={loanStatus === 'paid' ? 'primary' : 'ghost'}
              loading={busy}
              onClick={() =>
                void act('collateral_mark_returned', `Confirm you handed ${card} back to the borrower?`, 'ATM card returned.')
              }
            >
              Mark card returned
            </Button>
          </div>
        </>
      )}
      {error && <p className="alert alert--error">{error}</p>}
    </Card>
  )
}
