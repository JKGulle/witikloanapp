import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase.ts'
import { unwrap, useQuery } from '../../hooks/useQuery.ts'
import { formatMoney, loanProgress } from '../../lib/loan.ts'
import { STAFF_APPLICATION_SELECT } from '../../lib/staff.ts'
import type { Payment, StaffApplication } from '../../lib/types.ts'
import { Card } from '../../components/Card.tsx'
import { Loader } from '../../components/Loader.tsx'
import { ApplicationRow } from './AdminApplicationsPage.tsx'
import { fetchPenaltyStatuses } from '../../lib/penalty.ts'

export function AdminOverviewPage() {
  const { data, error, loading } = useQuery(async () => {
    const [apps, payments, penalties] = await Promise.all([
      supabase.from('loan_applications').select(STAFF_APPLICATION_SELECT).order('created_at', { ascending: false }),
      supabase.from('payments').select('*'),
      fetchPenaltyStatuses(),
    ])
    return { apps: unwrap(apps) as StaffApplication[], payments: unwrap(payments) as Payment[], penalties }
  }, [])

  if (loading) return <Loader label="Loading overview" />
  if (!data) return <p className="alert alert--error">{error}</p>

  const { apps, payments, penalties } = data
  const pending = apps.filter((a) => a.status === 'pending')
  const unassigned = pending.filter((a) => !a.investigator_id)
  const investigating = pending.filter((a) => a.investigator_id && !a.investigation)
  const awaitingDecision = pending.filter((a) => a.investigation)
  const awaitingDisbursement = apps.filter((a) => a.status === 'approved')
  const active = apps.filter((a) => a.status === 'disbursed')
  const overdue = active.filter((a) => (penalties.get(a.id)?.days_overdue ?? 0) > 0)
  const penaltiesDue = active.reduce((sum, a) => sum + (penalties.get(a.id)?.penalty_due ?? 0), 0)
  const outstanding = active.reduce(
    (sum, a) => sum + loanProgress(a, payments, penalties.get(a.id)?.penalty_paid ?? 0).outstanding,
    0,
  )
  const lent = apps
    .filter((a) => a.status === 'disbursed' || a.status === 'paid')
    .reduce((sum, a) => sum + Number(a.amount), 0)
  const collected = payments.reduce((sum, p) => sum + Number(p.amount), 0)

  const tiles = [
    { label: 'Needs an investigator', value: unassigned.length, view: 'unassigned' },
    { label: 'Under investigation', value: investigating.length, view: 'investigating' },
    { label: 'Awaiting decision', value: awaitingDecision.length, view: 'decision' },
    { label: 'Awaiting disbursement', value: awaitingDisbursement.length, view: 'approved' },
    { label: 'Active loans', value: active.length, view: 'active' },
    { label: 'Overdue loans', value: overdue.length, view: 'overdue', alert: overdue.length > 0 },
  ]
  const attention = [...overdue, ...awaitingDecision, ...awaitingDisbursement, ...unassigned].slice(0, 6)

  return (
    <div className="stack-lg">
      <h1 className="h1">Overview</h1>
      {error && <p className="alert alert--error">{error}</p>}

      <div className="stat-grid">
        {tiles.map((t) => (
          <Link key={t.view} to={`/admin/applications?view=${t.view}`} className="stat-link">
            <Card interactive className={t.alert ? 'stat stat--alert' : 'stat'}>
              <span className="stat__value">{t.value}</span>
              <span className="stat__label">{t.label}</span>
            </Card>
          </Link>
        ))}
      </div>

      <Card tone="accent" className="portfolio">
        <div>
          <span className="eyebrow">Total lent</span>
          <strong>{formatMoney(lent, true)}</strong>
        </div>
        <div>
          <span className="eyebrow">Collected</span>
          <strong>{formatMoney(collected, true)}</strong>
        </div>
        <div>
          <span className="eyebrow">Outstanding</span>
          <strong>{formatMoney(outstanding, true)}</strong>
        </div>
        <div>
          <span className="eyebrow">Penalties due</span>
          <strong className={penaltiesDue > 0 ? 'text-danger' : undefined}>{formatMoney(penaltiesDue, true)}</strong>
        </div>
      </Card>

      <section className="stack">
        <h2 className="h3">Needs attention</h2>
        {attention.length === 0 ? (
          <Card className="empty">
            <p className="muted">Nothing waiting on you right now.</p>
          </Card>
        ) : (
          attention.map((a) => <ApplicationRow key={a.id} app={a} penalty={penalties.get(a.id)} />)
        )}
      </section>
    </div>
  )
}
