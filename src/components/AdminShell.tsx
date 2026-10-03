import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/auth-context.ts'
import { QUEUE_TITLES, ROLE_LABELS } from '../lib/staff.ts'
import type { StaffRole } from '../lib/types.ts'
import { Logo } from './Logo.tsx'

const ALL_STAFF: StaffRole[] = ['admin', 'credit_investigator', 'cashier']

const LINKS: { to: string; label: string; roles: StaffRole[]; end: boolean }[] = [
  { to: '/admin', label: 'Overview', roles: ['admin'], end: true },
  { to: '/admin/applications', label: 'Applications', roles: ALL_STAFF, end: false },
  { to: '/admin/verifications', label: 'Verifications', roles: ['admin', 'credit_investigator'], end: false },
  { to: '/admin/payments', label: 'E-wallet', roles: ['admin', 'cashier'], end: false },
  { to: '/admin/reports', label: 'Reports', roles: ['admin'], end: false },
  { to: '/admin/staff', label: 'Staff', roles: ['admin'], end: false },
  { to: '/admin/audit', label: 'Audit log', roles: ['admin'], end: false },
]

export function AdminShell() {
  const { role, user, signOut } = useAuth()
  const location = useLocation()
  const links = LINKS.filter((l) => role && l.roles.includes(role))

  return (
    <div className="admin-shell">
      <header className="admin-shell__header">
        <div className="admin-shell__brand">
          <Logo />
          {role && <span className="role-badge">{ROLE_LABELS[role]}</span>}
        </div>
        <div className="admin-shell__user">
          <span className="muted small admin-shell__email">{user?.email}</span>
          <NavLink to="/faq" className="link small">
            Help
          </NavLink>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void signOut()}>
            <span className="btn__label">Sign out</span>
          </button>
        </div>
      </header>

      <nav className="admin-nav" aria-label="Admin">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className="admin-nav__link">
            {l.to === '/admin/applications' && role ? QUEUE_TITLES[role] : l.label}
          </NavLink>
        ))}
      </nav>

      <main>
        <div key={location.pathname} className="page">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
