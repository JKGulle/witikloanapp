import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from '../auth/auth-context.ts'
import { useLoanData } from '../hooks/useLoanData.ts'
import { useQuery } from '../hooks/useQuery.ts'
import { formatMoney } from '../lib/loan.ts'
import { amountDueNow } from '../lib/penalty.ts'
import { Card } from '../components/Card.tsx'
import { Loader } from '../components/Loader.tsx'
import { ActiveLoanCard } from '../components/ActiveLoanCard.tsx'
import { LoanOfferCard } from '../components/LoanOfferCard.tsx'
import { LoanRow } from './LoansPage.tsx'
import { VerifiedBadge } from '../components/VerifiedBadge.tsx'
import { useBorrowerShell } from '../hooks/useBorrowerShell.ts'

export function DashboardPage() {
  const { user } = useAuth()
  const { kycStatus } = useBorrowerShell()
  const { applications, payments, penalties, loading, error } = useLoanData()
  const offerInputs = useQuery(async () => {
    if (!user) return null
    const { data } = await supabase
      .from('profiles')
      .select('monthly_income, offer_amount, offer_note')
      .eq('id', user.id)
      .maybeSingle()
    const income = Number(data?.monthly_income ?? 0)
    return {
      income: income > 0 ? income : null,
      adminOffer: data?.offer_amount ? { amount: Number(data.offer_amount), note: data.offer_note as string | null } : null,
    }
  }, [user?.id])

  if (loading || offerInputs.loading) return <Loader label="Loading your dashboard" />

  const firstName = String(user?.user_metadata?.full_name ?? '').split(' ')[0]
  const overdue = applications
    .filter((a) => a.status === 'disbursed')
    .map((app) => ({ app, penalty: penalties.get(app.id) }))
    .filter(({ penalty }) => penalty && penalty.days_overdue > 0)
  const pendingCount = applications.filter((a) => a.status === 'pending').length
  // Approved (awaiting release) and active loans get a full card; everything else is "recent activity".
  const runningLoans = applications.filter((a) => a.status === 'approved' || a.status === 'disbursed')
  const otherApplications = applications.filter((a) => a.status !== 'approved' && a.status !== 'disbursed')

  return (
    <div className="stack-lg">
      <section>
        <p className="muted">Welcome back{firstName ? ',' : ''}</p>
        <h1 className="h1 name-with-badge">
          {firstName || 'Hello'}
          {kycStatus === 'verified' && <VerifiedBadge size="lg" />}
        </h1>
      </section>

      {error && <p className="alert alert--error">{error}</p>}

      {overdue.map(({ app, penalty }) => (
        <Link key={app.id} to={`/loans/${app.id}`} className="alert alert--error overdue-link">
          <strong>
            {app.purpose} loan is {penalty!.days_overdue} day{penalty!.days_overdue === 1 ? '' : 's'} overdue.
          </strong>{' '}
          Pay {formatMoney(amountDueNow(penalty!))} now to stop the {formatMoney(penalty!.penalty_per_day, true)}/day
          penalty. View details →
        </Link>
      ))}

      <LoanOfferCard
        monthlyIncome={offerInputs.data?.income ?? null}
        adminOffer={offerInputs.data?.adminOffer ?? null}
        overdueLoan={overdue[0]?.app ?? null}
      />

      {runningLoans.length > 0 && (
        <section className="stack">
          <h2 className="h3">My loans</h2>
          {runningLoans.map((a) => (
            <ActiveLoanCard key={a.id} app={a} payments={payments} penalty={penalties.get(a.id) ?? null} />
          ))}
        </section>
      )}

      <section className="stack">
        <div className="section-head">
          <h2 className="h3">Recent activity</h2>
          {applications.length > 0 && (
            <Link to="/loans" className="link">
              See all
            </Link>
          )}
        </div>
        {pendingCount > 0 && (
          <p className="alert alert--info">
            {pendingCount} application{pendingCount > 1 ? 's are' : ' is'} being reviewed.
          </p>
        )}
        {otherApplications.length === 0 ? (
          <Card className="empty">
            <p className="muted">
              {applications.length === 0 ? 'No loans yet. Your applications will appear here.' : 'No other applications.'}
            </p>
          </Card>
        ) : (
          otherApplications.slice(0, 3).map((a) => <LoanRow key={a.id} app={a} />)
        )}
      </section>
    </div>
  )
}
