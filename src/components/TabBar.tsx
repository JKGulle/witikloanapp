import type { CSSProperties } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { HomeIcon, LayersIcon, SparkIcon, UserIcon } from './icons.tsx'

const TABS = [
  { to: '/', label: 'Home', Icon: HomeIcon },
  { to: '/apply', label: 'Apply', Icon: SparkIcon },
  { to: '/loans', label: 'Loans', Icon: LayersIcon },
  { to: '/profile', label: 'Profile', Icon: UserIcon },
]

export function TabBar() {
  const { pathname } = useLocation()
  const active = TABS.findIndex((t) => (t.to === '/' ? pathname === '/' : pathname.startsWith(t.to)))

  return (
    <nav className="tabbar" aria-label="Main" style={{ '--active': active, '--count': TABS.length } as CSSProperties}>
      {active >= 0 && <span className="tabbar__indicator" aria-hidden="true" />}
      {TABS.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to} end={to === '/'} className="tabbar__item">
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
