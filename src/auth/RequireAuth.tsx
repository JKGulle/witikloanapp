import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './auth-context.ts'
import { Loader } from '../components/Loader.tsx'

/** Borrower area. Staff accounts are sent to the admin console instead. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, role, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Loader fullscreen label="Loading your account" />
  if (!session) return <Navigate to="/auth" replace state={{ from: location.pathname }} />
  if (role) return <Navigate to="/admin" replace />
  return children
}
