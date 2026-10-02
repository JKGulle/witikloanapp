import { Link } from 'react-router-dom'
import { useLoanData } from '../hooks/useLoanData.ts'
import { formatDate, formatMoney } from '../lib/loan.ts'
import type { LoanApplication } from '../lib/types.ts'
import { Card } from '../components/Card.tsx'
import { Loader } from '../components/Loader.tsx'
import { StatusPill } from '../components/StatusPill.tsx'
import { ChevronRightIcon } from '../components/icons.tsx'
import { ActiveLoanCard } from '../components/ActiveLoanCard.tsx'

export function LoanRow({ app }: { app: LoanApplication }) {
  return (
    <Link to={`/loans/${app.id}`} className="loan-row-link">
      <Card interactive className="loan-row">
        <div className="loan-row__main">
          <strong>{formatMoney(Number(app.amount))}</strong>
          <span className="muted small">
            {app.purpose} · {app.term_months} mo · {formatDate(app.created_at)}
          </span>
        </div>
        <StatusPill status={app.status} />
        <ChevronRightIcon />
      </Card>
    </Link>
  )
}

export function LoansPage() {
  const { applications, payments, penalties, loading, error } = useLoanData()

  if (loading) return <Loader label="Loading your loans" />

  const runningLoans = applications.filter((a) => a.status === 'approved' || a.status === 'disbursed')
  const otherApplications = applications.filter((a) => a.status !== 'approved' && a.status !== 'disbursed')

  return (
    <div className="stack-lg">
      <h1 className="h1">My loans</h1>
      {error && <p className="alert alert--error">{error}</p>}
      {applications.length === 0 ? (
        <Card className="empty stack">
          <p className="muted">You haven't applied for a loan yet.</p>
          <Link to="/apply" className="btn btn--primary">
            <span className="btn__label">Start an application</span>
          </Link>
        </Card>
      ) : (
        <>
          {runningLoans.length > 0 && (
            <section className="stack">
              <h2 className="h3">Active & approved</h2>
              {runningLoans.map((a) => (
                <ActiveLoanCard key={a.id} app={a} payments={payments} penalty={penalties.get(a.id) ?? null} />
              ))}
            </section>
          )}
          {otherApplications.length > 0 && (
            <section className="stack">
              <h2 className="h3">{runningLoans.length > 0 ? 'Other applications' : 'Applications'}</h2>
              {otherApplications.map((a) => (
                <LoanRow key={a.id} app={a} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
