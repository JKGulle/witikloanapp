import { Navigate, Route, Routes } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { Capacitor } from '@capacitor/core'
import { scrubAnalyticsEvent } from './lib/analytics.ts'
import { AppShell } from './components/AppShell.tsx'
import { RequireAuth } from './auth/RequireAuth.tsx'
import { isSupabaseConfigured } from './lib/supabase.ts'
import { SetupNotice } from './pages/SetupNotice.tsx'
import { AuthPage } from './pages/AuthPage.tsx'
import { DashboardPage } from './pages/DashboardPage.tsx'
import { ApplyPage } from './pages/ApplyPage.tsx'
import { LoansPage } from './pages/LoansPage.tsx'
import { LoanDetailPage } from './pages/LoanDetailPage.tsx'
import { ProfilePage } from './pages/ProfilePage.tsx'
import { RequireStaff } from './auth/RequireStaff.tsx'
import { IdleLogout } from './auth/IdleLogout.tsx'
import { FaqPage } from './pages/FaqPage.tsx'
import { ResetPasswordPage } from './pages/ResetPasswordPage.tsx'
import { AdminShell } from './components/AdminShell.tsx'
import { AdminOverviewPage } from './pages/admin/AdminOverviewPage.tsx'
import { AdminApplicationsPage } from './pages/admin/AdminApplicationsPage.tsx'
import { AdminApplicationDetailPage } from './pages/admin/AdminApplicationDetailPage.tsx'
import { StaffPage } from './pages/admin/StaffPage.tsx'
import { AuditLogPage } from './pages/admin/AuditLogPage.tsx'
import { VerificationDetailPage, VerificationsPage } from './pages/admin/VerificationsPage.tsx'
import { ReportsPage } from './pages/admin/ReportsPage.tsx'

export default function App() {
  return (
    <>
      {/* Web only: the Android app has no /_vercel endpoint to report to. */}
      {!Capacitor.isNativePlatform() && <Analytics beforeSend={scrubAnalyticsEvent} />}
      {isSupabaseConfigured && <IdleLogout />}
      {isSupabaseConfigured ? (
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="apply" element={<ApplyPage />} />
            <Route path="loans" element={<LoansPage />} />
            <Route path="loans/:id" element={<LoanDetailPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>
          <Route
            path="/admin"
            element={
              <RequireStaff>
                <AdminShell />
              </RequireStaff>
            }
          >
            <Route
              index
              element={
                <RequireStaff roles={['admin']}>
                  <AdminOverviewPage />
                </RequireStaff>
              }
            />
            <Route path="applications" element={<AdminApplicationsPage />} />
            <Route path="applications/:id" element={<AdminApplicationDetailPage />} />
            <Route
              path="verifications"
              element={
                <RequireStaff roles={['admin', 'credit_investigator']}>
                  <VerificationsPage />
                </RequireStaff>
              }
            />
            <Route
              path="verifications/:userId"
              element={
                <RequireStaff roles={['admin', 'credit_investigator']}>
                  <VerificationDetailPage />
                </RequireStaff>
              }
            />
            <Route
              path="reports"
              element={
                <RequireStaff roles={['admin']}>
                  <ReportsPage />
                </RequireStaff>
              }
            />
            <Route
              path="staff"
              element={
                <RequireStaff roles={['admin']}>
                  <StaffPage />
                </RequireStaff>
              }
            />
            <Route
              path="audit"
              element={
                <RequireStaff roles={['admin']}>
                  <AuditLogPage />
                </RequireStaff>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <SetupNotice />
      )}
    </>
  )
}
