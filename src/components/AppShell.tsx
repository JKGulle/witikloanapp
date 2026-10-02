import { Link, Outlet, useLocation } from 'react-router-dom'
import { Logo } from './Logo.tsx'
import { TabBar } from './TabBar.tsx'
import { useAuth } from '../auth/auth-context.ts'

export function AppShell() {
  const location = useLocation()
  const { user } = useAuth()
  const name: string = user?.user_metadata?.full_name ?? user?.email ?? ''

  return (
    <div className="shell">
      <header className="shell__header">
        <Link to="/" aria-label="Witik home">
          <Logo />
        </Link>
        <Link to="/profile" className="avatar" aria-label="Your profile">
          {name.trim().charAt(0).toUpperCase() || '?'}
        </Link>
      </header>
      <main className="shell__main">
        <div key={location.pathname} className="page">
          <Outlet />
        </div>
      </main>
      <TabBar />
    </div>
  )
}
