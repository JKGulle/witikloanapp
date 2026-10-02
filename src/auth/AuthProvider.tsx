import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase.ts'
import type { StaffRole } from '../lib/types.ts'
import { AuthContext, type AuthState } from './auth-context.ts'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoading, setSessionLoading] = useState(isSupabaseConfigured)
  // Role is resolved per user id; `roleFor` records which user the current `role` belongs to.
  const [role, setRole] = useState<StaffRole | null>(null)
  const [roleFor, setRoleFor] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase.rpc('current_staff_role').then(({ data }) => {
      if (cancelled) return
      setRole((data as StaffRole | null) ?? null)
      setRoleFor(userId)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const roleLoading = userId !== null && roleFor !== userId

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      role: userId && roleFor === userId ? role : null,
      loading: sessionLoading || roleLoading,
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }),
    [session, userId, role, roleFor, sessionLoading, roleLoading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
