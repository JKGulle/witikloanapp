import { Link, Outlet, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase.ts'
import { useQuery } from '../hooks/useQuery.ts'
import type { KycStatus } from '../lib/types.ts'
import type { BorrowerShellContext } from '../hooks/useBorrowerShell.ts'
import { Logo } from './Logo.tsx'
import { TabBar } from './TabBar.tsx'
import { VerifiedBadge } from './VerifiedBadge.tsx'
import { useAuth } from '../auth/auth-context.ts'

export function AppShell() {
  const location = useLocation()
  const { user } = useAuth()
  const name: string = user?.user_metadata?.full_name ?? user?.email ?? ''
  const profile = useQuery(async () => {
    if (!user) return null
    const { data } = await supabase.from('profiles').select('kyc_status').eq('id', user.id).maybeSingle()
    return (data?.kyc_status as KycStatus | undefined) ?? null
  }, [user?.id])
  const verified = profile.data === 'verified'

  return (
    <div className="shell">
      <header className="shell__header">
        <Link to="/" aria-label="Witik home">
          <Logo />
        </Link>
        <Link
          to="/profile"
          className="avatar"
          aria-label={verified ? 'Your profile (identity verified)' : 'Your profile'}
        >
          {name.trim().charAt(0).toUpperCase() || '?'}
          {verified && (
            <span className="avatar__badge">
              <VerifiedBadge size="sm" />
            </span>
          )}
        </Link>
      </header>
      <main className="shell__main">
        <div key={location.pathname} className="page">
          <Outlet context={{ kycStatus: profile.data ?? null, refreshProfile: profile.reload } satisfies BorrowerShellContext} />
        </div>
      </main>
      <TabBar />
    </div>
  )
}
