import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase.ts'
import { unwrap, useQuery } from '../../hooks/useQuery.ts'
import { formatMoney } from '../../lib/loan.ts'
import { ROLE_LABELS, describeAction, formatDateTime } from '../../lib/staff.ts'
import { idTypeLabel } from '../../lib/kyc.ts'
import type { AuditEntry, IdType, StaffRole } from '../../lib/types.ts'
import { Card } from '../../components/Card.tsx'
import { Loader } from '../../components/Loader.tsx'

const PAGE_SIZE = 200

function detailText(details: Record<string, unknown>): string {
  const parts: string[] = []
  if (typeof details.amount === 'number') parts.push(formatMoney(details.amount))
  if (typeof details.role === 'string') parts.push(ROLE_LABELS[details.role as StaffRole] ?? details.role)
  if (typeof details.id_type === 'string') parts.push(idTypeLabel(details.id_type as IdType))
  if (typeof details.recommendation === 'string') parts.push(`recommends ${details.recommendation}`)
  if (typeof details.risk_rating === 'string') parts.push(`${details.risk_rating} risk`)
  if (typeof details.reference === 'string') parts.push(`ref ${details.reference}`)
  if (typeof details.reason === 'string') parts.push(`“${details.reason}”`)
  return parts.join(' · ')
}

export function AuditLogPage() {
  const { data, error, loading } = useQuery(async () => {
    const entries = unwrap(
      await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(PAGE_SIZE),
    ) as AuditEntry[]
    const ids = [...new Set(entries.flatMap((e) => [e.actor_id, e.subject_user_id]).filter(Boolean))] as string[]
    const [staff, profiles] = await Promise.all([
      supabase.from('staff').select('user_id, full_name').in('user_id', ids),
      supabase.from('profiles').select('id, full_name').in('id', ids),
    ])
    const names = new Map<string, string>()
    for (const p of unwrap(profiles) as { id: string; full_name: string | null }[]) {
      if (p.full_name) names.set(p.id, p.full_name)
    }
    for (const s of unwrap(staff) as { user_id: string; full_name: string }[]) names.set(s.user_id, s.full_name)
    return { entries, names }
  }, [])

  if (loading) return <Loader label="Loading audit log" />

  const name = (id: string | null) => (id ? (data?.names.get(id) ?? 'Unknown user') : 'System')

  return (
    <div className="stack-lg">
      <div className="section-head">
        <h1 className="h1">Audit log</h1>
        <span className="muted small">Latest {PAGE_SIZE}</span>
      </div>
      {error && <p className="alert alert--error">{error}</p>}
      {data && data.entries.length === 0 && (
        <Card className="empty">
          <p className="muted">No staff actions recorded yet.</p>
        </Card>
      )}
      {data && data.entries.length > 0 && (
        <Card className="table-wrap">
          <table className="schedule audit">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Subject</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatDateTime(e.created_at)}</td>
                  <td>{name(e.actor_id)}</td>
                  <td>
                    {e.application_id ? (
                      <Link to={`/admin/applications/${e.application_id}`} className="link">
                        {describeAction(e)}
                      </Link>
                    ) : (
                      describeAction(e)
                    )}
                  </td>
                  <td>{e.subject_user_id ? name(e.subject_user_id) : '—'}</td>
                  <td className="muted">{detailText(e.details) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
