import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL ?? ''
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''

export const isSupabaseConfigured = Boolean(url && key && !url.includes('YOUR_') && !key.includes('YOUR_'))

// Placeholder values keep the client constructible while the app shows the setup screen.
const clientUrl = isSupabaseConfigured ? url : 'http://localhost:54321'
const clientKey = isSupabaseConfigured ? key : 'not-configured'

const storageKey = `sb-${new URL(clientUrl).hostname.split('.')[0]}-auth-token`

// The session lives in sessionStorage, so closing the app or browser tab signs
// the user out. Clear any session that older builds persisted in localStorage.
try {
  localStorage.removeItem(storageKey)
} catch {
  // Storage can be unavailable (private mode, blocked site data); nothing to clear.
}

export const supabase = createClient(clientUrl, clientKey, {
  auth: {
    storage: typeof window === 'undefined' ? undefined : window.sessionStorage,
    storageKey,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

/**
 * Base URL for links in emails (sign-up confirmation, password reset). In the
 * Android app window.location is the device's own localhost, so production
 * builds must set VITE_PUBLIC_SITE_URL to the hosted web address.
 */
export const siteUrl = (import.meta.env.VITE_PUBLIC_SITE_URL || window.location.origin).replace(/\/+$/, '')

/**
 * Signs up a separate account without touching the current session — used by
 * admins to create staff accounts. Uses the public key only; the role itself
 * is granted afterwards by the admin-only admin_grant_staff_role() function.
 */
export function signUpWithoutSession(email: string, password: string, fullName: string) {
  const isolated = createClient(clientUrl, clientKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'witik-staff-signup' },
  })
  return isolated.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName }, emailRedirectTo: `${siteUrl}/auth` },
  })
}
