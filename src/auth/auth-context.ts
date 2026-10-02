import { createContext, useContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { StaffRole } from '../lib/types.ts'

export interface AuthState {
  session: Session | null
  user: User | null
  /** Staff role of the signed-in user; null for borrowers. */
  role: StaffRole | null
  loading: boolean
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
