import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase.ts'
import { useAuth } from '../../auth/auth-context.ts'
import { unwrap, useQuery } from '../../hooks/useQuery.ts'
import { formatDate, formatMoney } from '../../lib/loan.ts'
import { QUEUE_TITLES, STAFF_APPLICATION_SELECT } from '../../lib/staff.ts'
import type { StaffApplication, StaffRole } from '../../lib/types.ts'
import { Card } from '../../components/Card.tsx'
import { Loader } from '../../components/Loader.tsx'
import { StatusPill } from '../../components/StatusPill.tsx'
import { ChevronRightIcon } from '../../components/icons.tsx'
import { fetchPenaltyStatuses, type PenaltyStatus } from '../../lib/penalty.ts'

interface View {
  key: string
  label: string
  roles: StaffRole[]
  match: (a: StaffApplication, penalty?: PenaltyStatus) => boolean
}

const VIEWS: View[] = [
  { key: 'all', label: 'All', roles: ['admin', 'credit_investigator', 'cashier'], match: () => true },
  {
    key: 'unassigned',
    label: 'Unassigned',
    roles: ['admin'],
    match: (a) => a.status === 'pending' && !a.investigator_id,
  },
  {
    key: 'investigating',
    label: 'To investigate',
    roles: ['admin', 'credit_investigator'],
    match: (a) => a.status === 'pending' && !!a.investigator_id && !a.investigation,
  },
  {
    key: 'decision',
    label: 'Awaiting decision',
    roles: ['admin', 'credit_investigator'],
    match: (a) => a.status === 'pending' && !!a.investigation,
  },
  { key: 'approved', label: 'To release', roles: ['admin', 'cashier'], match: (a) => a.status === 'approved' },
  {
    key: 'active',
    label: 'Active',
    roles: ['admin', 'credit_investigator', 'cashier'],
    match: (a) => a.status === 'disbursed',
  },
  {
    key: 'overdue',
    label: 'Overdue',
    roles: ['admin', 'credit_investigator', 'cashier'],
    match: (a, p) => a.status === 'disbursed' && (p?.days_overdue ?? 0) > 0,
  },
  {
    key: 'closed',
    label: 'Closed',
    roles: ['admin', 'credit_investigator', 'cashier'],
    match: (a) => a.status === 'paid' || a.status === 'rejected' || a.status === 'cancelled',
  },
]

export function ApplicationRow({ app, penalty }: { app: StaffApplication; penalty?: PenaltyStatus }) {
  const overdueDays = app.status === 'disbursed' ? (penalty?.days_overdue ?? 0) : 0
  return (
    <Link to={`/admin/applications/${app.id}`} className="loan-row-link">
      <Card interactive className="loan-row">
        <div className="loan-row__main">
          <strong>{app.profile?.full_name || 'Unnamed borrower'}</strong>
          <span className="muted small">
            {formatMoney(Number(app.amount), true)} · {app.term_months} mo · {app.purpose} · {formatDate(app.created_at)}
          </span>
          <span className="small row-meta">
            {app.investigator ? `CI: ${app.investigator.full_name}` : app.status === 'pending' ? 'No investigator' : ''}
            {app.investigation && (
              <span className={`rec rec--${app.investigation.recommendation}`}>
                Recommends {app.investigation.recommendation}
              </span>
            )}
            {overdueDays > 0 && (
              <span className="rec rec--overdue">
                {overdueDays} day{overdueDays === 1 ? '' : 's'} overdue · {formatMoney(penalty!.penalty_due, true)} penalty
              </span>
            )}
          </span>
        </div>
        <StatusPill status={app.status} />
        <ChevronRightIcon />
      </Card>
    </Link>
  )
}

export function AdminApplicationsPage() {
  const { role } = useAuth()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const views = VIEWS.filter((v) => role && v.roles.includes(role))
  const view = views.find((v) => v.key === params.get('view')) ?? views[0]

  const { data, error, loading } = useQuery(async () => {
    const [apps, penalties] = await Promise.all([
      supabase.from('loan_applications').select(STAFF_APPLICATION_SELECT).order('created_at', { ascending: false }),
      fetchPenaltyStatuses(),
    ])
    return { apps: unwrap(apps) as StaffApplication[], penalties }
  }, [])
  const apps = data?.apps ?? []
  const penalties = data?.penalties ?? new Map<string, PenaltyStatus>()

  const term = search.trim().toLowerCase()
  const rows = apps.filter(
    (a) =>
      view.match(a, penalties.get(a.id)) &&
      (!term || `${a.profile?.full_name ?? ''} ${a.purpose}`.toLowerCase().includes(term)),
  )

  return (
    <div className="stack-lg">
      <h1 className="h1">{role ? QUEUE_TITLES[role] : 'Applications'}</h1>

      <div className="filter-bar">
        <div className="chips" role="tablist">
          {views.map((v) => (
            <button
              key={v.key}
              role="tab"
              aria-selected={v.key === view.key}
              className="chip"
              onClick={() => setParams(v.key === 'all' ? {} : { view: v.key })}
            >
              {v.label}
              <span className="chip__count">{apps.filter((a) => v.match(a, penalties.get(a.id))).length}</span>
            </button>
          ))}
        </div>
        <input
          className="input search"
          type="search"
          placeholder="Search borrower or purpose"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <p className="alert alert--error">{error}</p>}
      {loading ? (
        <Loader label="Loading applications" />
      ) : rows.length === 0 ? (
        <Card className="empty">
          <p className="muted">No applications here.</p>
        </Card>
      ) : (
        <div className="stack">
          {rows.map((a) => (
            <ApplicationRow key={a.id} app={a} penalty={penalties.get(a.id)} />
          ))}
        </div>
      )}
    </div>
  )
}
