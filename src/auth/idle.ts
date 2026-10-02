/** Sign out after this long without user interaction. */
export const IDLE_LIMIT_MS = 5 * 60_000
/** Show the "still there?" warning this long before signing out. */
export const IDLE_WARNING_MS = 60_000

// Both keys live in sessionStorage, alongside the session itself.
const LAST_ACTIVE_KEY = 'witik-last-active'
const LOGOUT_REASON_KEY = 'witik-logout-reason'

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {
    // Storage unavailable: the in-memory timer still enforces the limit.
  }
}

export const readLastActive = (): number | null => {
  const value = Number(read(LAST_ACTIVE_KEY))
  return Number.isFinite(value) && value > 0 ? value : null
}
export const writeLastActive = (time: number | null) => write(LAST_ACTIVE_KEY, time === null ? null : String(time))

export const markIdleLogout = () => write(LOGOUT_REASON_KEY, 'idle')
export const wasIdleLogout = () => read(LOGOUT_REASON_KEY) === 'idle'
export const clearLogoutReason = () => write(LOGOUT_REASON_KEY, null)
