import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from './auth-context.ts'
import { Button } from '../components/Button.tsx'
import { IDLE_LIMIT_MS, IDLE_WARNING_MS, markIdleLogout, readLastActive, writeLastActive } from './idle.ts'

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
/** Persist activity at most this often; the in-memory value is always current. */
const PERSIST_EVERY_MS = 5_000

/**
 * Signs the user out after IDLE_LIMIT_MS without interaction, warning them first.
 * Timers pause while the app is in the background, so the clock is also checked
 * whenever the app becomes visible again — returning after 5 minutes means signing in again.
 */
export function IdleLogout() {
  const { session, loading } = useAuth()
  const signedIn = !loading && session !== null
  const lastActive = useRef(Date.now())
  const lastPersisted = useRef(0)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)

  const signOutIdle = useCallback(async () => {
    markIdleLogout()
    writeLastActive(null)
    setSecondsLeft(null)
    await supabase.auth.signOut({ scope: 'local' })
  }, [])

  const recordActivity = useCallback(() => {
    const now = Date.now()
    lastActive.current = now
    if (now - lastPersisted.current > PERSIST_EVERY_MS) {
      lastPersisted.current = now
      writeLastActive(now)
    }
  }, [])

  const check = useCallback(() => {
    const remaining = IDLE_LIMIT_MS - (Date.now() - lastActive.current)
    if (remaining <= 0) void signOutIdle()
    else setSecondsLeft(remaining <= IDLE_WARNING_MS ? Math.ceil(remaining / 1000) : null)
  }, [signOutIdle])

  useEffect(() => {
    if (loading) return
    if (!session) {
      // Signed out (manually or idle): forget activity so the next sign-in starts fresh.
      writeLastActive(null)
      return
    }

    // Restored session (reload / resume): honour the time already spent idle.
    lastActive.current = readLastActive() ?? Date.now()
    writeLastActive(lastActive.current)
    check()

    const onActivity = () => {
      recordActivity()
      setSecondsLeft(null)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, onActivity, { passive: true, capture: true })
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(check, 1000)

    const nativeListener = Capacitor.isNativePlatform()
      ? NativeApp.addListener('appStateChange', ({ isActive }) => isActive && check())
      : null

    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity, { capture: true })
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
      void nativeListener?.then((l) => l.remove())
    }
    // Re-run only when the signed-in user changes, not on every token refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session?.user.id, check, recordActivity])

  if (!signedIn || secondsLeft === null) return null

  return (
    <div className="modal-backdrop">
      <div className="modal card" role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-desc">
        <h2 id="idle-title" className="h3">Still there?</h2>
        <p id="idle-desc" className="muted">
          For your security, you'll be signed out in{' '}
          <strong className="modal__count" aria-live="polite">
            {secondsLeft}s
          </strong>{' '}
          because of inactivity.
        </p>
        <div className="button-row">
          <Button variant="ghost" onClick={() => void signOutIdle()}>
            Sign out
          </Button>
          <Button
            autoFocus
            onClick={() => {
              recordActivity()
              setSecondsLeft(null)
            }}
          >
            Stay signed in
          </Button>
        </div>
      </div>
    </div>
  )
}
