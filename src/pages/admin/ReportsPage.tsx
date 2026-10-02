import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase.ts'
import { useAuth } from '../../auth/auth-context.ts'
import { unwrap, useQuery } from '../../hooks/useQuery.ts'
import { formatMoney } from '../../lib/loan.ts'
import { formatDateTime } from '../../lib/staff.ts'
import { fetchPenaltyStatuses } from '../../lib/penalty.ts'
import {
  buildReport,
  makePeriod,
  parseISODate,
  shiftPeriod,
  toISODate,
  type PeriodKind,
  type ReportApplication,
  type ReportInput,
} from '../../lib/reports.ts'
import type { Payment } from '../../lib/types.ts'
import { Card } from '../../components/Card.tsx'
import { Button } from '../../components/Button.tsx'
import { Loader } from '../../components/Loader.tsx'
import { BarChart } from '../../components/BarChart.tsx'

const KINDS: { kind: PeriodKind; label: string }[] = [
  { kind: 'day', label: 'Day' },
  { kind: 'week', label: 'Week' },
  { kind: 'month', label: 'Month' },
  { kind: 'year', label: 'Year' },
  { kind: 'range', label: 'Date range' },
]

// Series colors validated together (CVD-safe, ≥3:1 on white paper).
const RELEASED_COLOR = '#a23f68'
const COLLECTED_COLOR = '#2f9fb3'

const compactPeso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  notation: 'compact',
  maximumFractionDigits: 1,
})
const percent = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const yearOptions = () => {
  const now = new Date().getFullYear()
  return Array.from({ length: 6 }, (_, i) => now + 1 - i)
}

/** Admin analytics with a printable report for a day, week, month, year or date range. */
export function ReportsPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  // Fixed when the page opens: the default period and the report's "generated" time.
  const [generatedAt] = useState(() => new Date())
  const kind = (KINDS.find((k) => k.kind === params.get('kind'))?.kind ?? 'month') as PeriodKind
  const anchor = parseISODate(params.get('date')) ?? generatedAt
  const rangeEnd = parseISODate(params.get('to')) ?? anchor
  const period = makePeriod(kind, anchor, rangeEnd)

  function go(nextKind: PeriodKind, date: Date, to?: Date) {
    const next: Record<string, string> = { kind: nextKind, date: toISODate(date) }
    if (nextKind === 'range') next.to = toISODate(to ?? date)
    setParams(next, { replace: true })
  }

  const startISO = period.start.toISOString()
  const endISO = period.end.toISOString()

  const { data, error, loading } = useQuery(async (): Promise<ReportInput> => {
    const [apps, payments, audit, kyc, staff, penalties] = await Promise.all([
      supabase.from('loan_applications').select('*, profile:profiles(full_name)'),
      supabase.from('payments').select('*').gte('paid_at', startISO).lt('paid_at', endISO),
      supabase
        .from('audit_log')
        .select('action, details, created_at')
        .in('action', ['payment.recorded', 'kyc.verified', 'kyc.rejected'])
        .gte('created_at', startISO)
        .lt('created_at', endISO),
      supabase.from('kyc_submissions').select('user_id', { count: 'exact', head: true }).gte('submitted_at', startISO).lt('submitted_at', endISO),
      supabase.from('staff').select('user_id, full_name'),
      fetchPenaltyStatuses(),
    ])
    if (kyc.error) throw new Error(kyc.error.message)
    return {
      applications: unwrap(apps) as ReportApplication[],
      payments: unwrap(payments) as Payment[],
      audit: unwrap(audit) as ReportInput['audit'],
      kycSubmitted: kyc.count ?? 0,
      penalties,
      staffNames: new Map((unwrap(staff) as { user_id: string; full_name: string }[]).map((s) => [s.user_id, s.full_name])),
    }
  }, [startISO, endISO])

  const report = data ? buildReport(data, period) : null

  // Printed reports show every table, including ones collapsed on screen.
  useEffect(() => {
    const open = () => document.querySelectorAll<HTMLDetailsElement>('details.report-details').forEach((d) => (d.open = true))
    window.addEventListener('beforeprint', open)
    return () => window.removeEventListener('beforeprint', open)
  }, [])

  return (
    <div className="stack-lg report">
      <div className="report-controls stack">
        <div className="section-head">
          <h1 className="h1">Reports</h1>
          <Button onClick={() => window.print()} disabled={!report}>
            Print / Save as PDF
          </Button>
        </div>

        <div className="chips" role="tablist" aria-label="Report period">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              role="tab"
              aria-selected={k.kind === kind}
              className="chip"
              onClick={() => go(k.kind, period.start, k.kind === 'range' ? addDaysSafe(period.end, -1) : undefined)}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className="period-bar">
          <button type="button" className="chip" onClick={() => go(kind, shiftPeriod(period, -1).start, addDaysSafe(shiftPeriod(period, -1).end, -1))} aria-label="Previous period">
            ←
          </button>
          <PeriodInput kind={kind} start={period.start} end={period.end} onChange={go} />
          <button type="button" className="chip" onClick={() => go(kind, shiftPeriod(period, 1).start, addDaysSafe(shiftPeriod(period, 1).end, -1))} aria-label="Next period">
            →
          </button>
          <button type="button" className="text-button" onClick={() => go(kind, new Date(), new Date())}>
            Today
          </button>
        </div>
      </div>

      <header className="report-header">
        <img src="/witik-icon.png" alt="" width={48} height={48} />
        <div>
          <span className="eyebrow">Witik Loan · Loan report</span>
          <h2 className="report-header__title">{period.label}</h2>
          <span className="muted small">
            Generated {formatDateTime(generatedAt.toISOString())}
            {user?.email ? ` by ${user.email}` : ''}
          </span>
        </div>
      </header>

      {error && <p className="alert alert--error">{error}</p>}
      {loading || !report ? (
        <Loader label="Building report" />
      ) : (
        <>
          <section className="stat-grid report-stats" aria-label="Key figures">
            <Stat label="Applications received" value={String(report.applications.received)} note={`${formatMoney(report.applications.requested, true)} requested`} />
            <Stat
              label="Approval rate"
              value={percent(report.applications.approvalRate)}
              note={`${report.applications.approved} approved · ${report.applications.rejected} rejected`}
            />
            <Stat label="Loans released" value={formatMoney(report.releases.total, true)} note={`${report.releases.count} loan${report.releases.count === 1 ? '' : 's'}`} />
            <Stat
              label="Collected"
              value={formatMoney(report.collections.total, true)}
              note={`${report.collections.count} payment${report.collections.count === 1 ? '' : 's'} · ${formatMoney(report.collections.penalties, true)} penalties`}
            />
            <Stat label="IDs verified" value={String(report.kyc.verified)} note={`${report.kyc.submitted} submitted · ${report.kyc.rejected} rejected`} />
          </section>

          <Card className="stack report-section">
            <h2 className="h3">Money released vs collected</h2>
            <BarChart
              title={`Money released and collected, ${period.label}`}
              labels={report.buckets.map((b) => b.label)}
              series={[
                { key: 'released', label: 'Released', color: RELEASED_COLOR, values: report.buckets.map((b) => b.released) },
                { key: 'collected', label: 'Collected', color: COLLECTED_COLOR, values: report.buckets.map((b) => b.collected) },
              ]}
              format={(v) => formatMoney(v)}
              formatTick={(v) => compactPeso.format(v)}
            />
          </Card>

          <Card className="stack report-section">
            <h2 className="h3">Applications received</h2>
            <BarChart
              title={`Applications received, ${period.label}`}
              labels={report.buckets.map((b) => b.label)}
              series={[{ key: 'apps', label: 'Applications', color: RELEASED_COLOR, values: report.buckets.map((b) => b.applications) }]}
              format={(v) => `${v} application${v === 1 ? '' : 's'}`}
              formatTick={(v) => (Number.isInteger(v) ? String(v) : '')}
              height={180}
            />
            <details className="report-details">
              <summary className="link">Show as table</summary>
              <Table
                head={['Period', 'Applications', 'Released', 'Collected']}
                numeric={[1, 2, 3]}
                rows={report.buckets.map((b) => [b.label, String(b.applications), formatMoney(b.released), formatMoney(b.collected)])}
                foot={['Total', String(report.applications.received), formatMoney(report.releases.total), formatMoney(report.collections.total)]}
              />
            </details>
          </Card>

          <Card tone="accent" className="stack report-section">
            <div className="section-head">
              <h2 className="h3">Portfolio snapshot</h2>
              <span className="muted small">As of {formatDateTime(generatedAt.toISOString())}</span>
            </div>
            <dl className="report-kv">
              <Kv label="Active loans" value={String(report.portfolio.activeLoans)} />
              <Kv label="Outstanding (incl. penalties)" value={formatMoney(report.portfolio.outstanding)} />
              <Kv label="Overdue loans" value={String(report.portfolio.overdueCount)} danger={report.portfolio.overdueCount > 0} />
              <Kv label="Amount overdue" value={formatMoney(report.portfolio.amountOverdue)} danger={report.portfolio.amountOverdue > 0} />
              <Kv label="Penalties due" value={formatMoney(report.portfolio.penaltiesDue)} />
              <Kv label="Portfolio at risk" value={percent(report.portfolio.portfolioAtRisk)} danger={report.portfolio.portfolioAtRisk > 0} />
              <Kv label="Loans paid off (all time)" value={String(report.portfolio.paidOff)} />
            </dl>
            {report.portfolio.overdueLoans.length > 0 && (
              <Table
                head={['Overdue loan', 'Days overdue', 'Due now']}
                numeric={[1, 2]}
                rows={report.portfolio.overdueLoans.map((l) => [
                  <Link key={l.id} to={`/admin/applications/${l.id}`} className="link">
                    {l.borrower}
                  </Link>,
                  String(l.days),
                  formatMoney(l.dueNow),
                ])}
              />
            )}
          </Card>

          <div className="grid-2">
            <Card className="stack report-section">
              <h2 className="h3">Applications by purpose</h2>
              <Table
                head={['Purpose', 'Applications', 'Amount requested']}
                numeric={[1, 2]}
                rows={report.applications.byPurpose.map((p) => [p.purpose, String(p.count), formatMoney(p.amount)])}
                empty="No applications in this period."
              />
              {report.applications.cancelled > 0 && (
                <p className="muted small">{report.applications.cancelled} application(s) were cancelled by borrowers.</p>
              )}
            </Card>

            <Card className="stack report-section">
              <h2 className="h3">Cashier activity</h2>
              <Table
                head={['Handled by', 'Releases', 'Released', 'Payments', 'Collected']}
                numeric={[1, 2, 3, 4]}
                rows={report.byCashier.map((c) => [c.name, String(c.releases), formatMoney(c.released), String(c.payments), formatMoney(c.collected)])}
                empty="No releases or payments in this period."
              />
            </Card>
          </div>

          <Card className="stack report-section">
            <h2 className="h3">Loans released ({report.releases.count})</h2>
            <Table
              head={['Date', 'Borrower', 'Purpose', 'Reference', 'Released by', 'Amount']}
              numeric={[5]}
              rows={report.releases.rows.map((r) => [
                formatDateTime(r.at),
                <Link key={r.id} to={`/admin/applications/${r.id}`} className="link">
                  {r.borrower}
                </Link>,
                r.purpose,
                r.reference ?? '—',
                r.by,
                formatMoney(r.amount),
              ])}
              foot={['Total', '', '', '', '', formatMoney(report.releases.total)]}
              empty="No loans released in this period."
            />
          </Card>

          <Card className="stack report-section">
            <h2 className="h3">Payments collected ({report.collections.count})</h2>
            <Table
              head={['Date', 'Borrower', 'Reference', 'Received by', 'Amount']}
              numeric={[4]}
              rows={report.collections.rows.map((c) => [
                formatDateTime(c.at),
                <Link key={c.id} to={`/admin/applications/${c.applicationId}`} className="link">
                  {c.borrower}
                </Link>,
                c.reference ?? '—',
                c.by,
                formatMoney(c.amount),
              ])}
              foot={['Total', '', '', '', formatMoney(report.collections.total)]}
              empty="No payments collected in this period."
            />
            {report.collections.total > 0 && (
              <p className="muted small">
                Of this, {formatMoney(report.collections.installments)} went to installments and{' '}
                {formatMoney(report.collections.penalties)} to late penalties.
              </p>
            )}
          </Card>

          <p className="muted small report-footnote">
            Period figures count events dated within {period.label} (Philippine time on this device). The portfolio
            snapshot shows balances at the moment the report was generated.
          </p>
        </>
      )}
    </div>
  )
}

const addDaysSafe = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

function PeriodInput({
  kind,
  start,
  end,
  onChange,
}: {
  kind: PeriodKind
  start: Date
  end: Date
  onChange: (kind: PeriodKind, date: Date, to?: Date) => void
}) {
  const last = addDaysSafe(end, -1)
  if (kind === 'year') {
    return (
      <select
        className="input period-input"
        value={start.getFullYear()}
        onChange={(e) => onChange('year', new Date(Number(e.target.value), 0, 1))}
        aria-label="Year"
      >
        {yearOptions().map((y) => (
          <option key={y}>{y}</option>
        ))}
      </select>
    )
  }
  if (kind === 'month') {
    return (
      <input
        className="input period-input"
        type="month"
        aria-label="Month"
        value={toISODate(start).slice(0, 7)}
        onChange={(e) => {
          const d = parseISODate(`${e.target.value}-01`)
          if (d) onChange('month', d)
        }}
      />
    )
  }
  if (kind === 'range') {
    return (
      <span className="period-range">
        <input
          className="input period-input"
          type="date"
          aria-label="From"
          value={toISODate(start)}
          onChange={(e) => {
            const d = parseISODate(e.target.value)
            if (d) onChange('range', d, last)
          }}
        />
        <span className="muted">to</span>
        <input
          className="input period-input"
          type="date"
          aria-label="To"
          value={toISODate(last)}
          onChange={(e) => {
            const d = parseISODate(e.target.value)
            if (d) onChange('range', start, d)
          }}
        />
      </span>
    )
  }
  return (
    <input
      className="input period-input"
      type="date"
      aria-label={kind === 'week' ? 'Any day in the week' : 'Day'}
      value={toISODate(start)}
      onChange={(e) => {
        const d = parseISODate(e.target.value)
        if (d) onChange(kind, d)
      }}
    />
  )
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      <span className="muted small">{note}</span>
    </Card>
  )
}

function Kv({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={danger ? 'text-danger' : undefined}>{value}</dd>
    </div>
  )
}

function Table({
  head,
  rows,
  foot,
  numeric = [],
  empty = 'Nothing to show.',
}: {
  head: string[]
  rows: ReactNode[][]
  foot?: string[]
  numeric?: number[]
  empty?: string
}) {
  if (rows.length === 0) return <p className="muted small">{empty}</p>
  const align = (i: number) => (numeric.includes(i) ? 'num' : undefined)
  return (
    <div className="table-scroll">
      <table className="report-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h + i} className={align(i)}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, i) => (
                <td key={i} className={align(i)}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr>
              {foot.map((f, i) => (
                <td key={i} className={align(i)}>
                  {f}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
