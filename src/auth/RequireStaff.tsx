import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './auth-context.ts'
import { Loader } from '../components/Loader.tsx'
import type { StaffRole } from '../lib/types.ts'

/**
 * Staff area. UI gating only — the database enforces every permission again
 * through row-level security and role-checked functions.
 */
export function RequireStaff({ roles, children }: { roles?: StaffRole[]; children: ReactNode }) {
  const { session, role, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Loader fullscreen label="Checking access" />
  if (!session) return <Navigate to="/auth" replace state={{ from: location.pathname }} />
  if (!role) return <Navigate to="/" replace />
  if (roles && !roles.includes(role)) return <Navigate to="/admin/applications" replace />
  return children
}
