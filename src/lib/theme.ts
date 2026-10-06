import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'

/**
 * App theme. The preference is per device (localStorage), like the system setting it can follow.
 * public/theme-init.js applies it before first paint; this module keeps it applied afterwards.
 */
export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'witik-theme'
const DEFAULT: ThemePreference = 'light'
/** Browser/status-bar colour per theme; matches --c-bg in index.css. */
const THEME_COLOR = { light: '#F5E0E8', dark: '#2A1F26' } as const

const darkQuery = typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

export function getThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT
  } catch {
    return DEFAULT
  }
}

function resolve(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'system') return darkQuery?.matches ? 'dark' : 'light'
  return pref
}

function apply(pref: ThemePreference) {
  const theme = resolve(pref)
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
  if (Capacitor.isNativePlatform()) void syncStatusBar(theme)
}

/**
 * Native apps: status-bar icons light on the dark theme, dark on the light one. The page normally
 * draws behind the bar (always on Android 15+, which is edge-to-edge), so its background already
 * matches; where Android still draws a solid bar, that bar gets the theme's background colour.
 */
async function syncStatusBar(theme: 'light' | 'dark') {
  try {
    await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light })
    if (Capacitor.getPlatform() === 'android') await StatusBar.setBackgroundColor({ color: THEME_COLOR[theme] })
  } catch {
    // Not supported on this OS version (e.g. background colour on Android 15+): nothing to do.
  }
}

export function setThemePreference(pref: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // Storage blocked: the theme still applies for this visit.
  }
  apply(pref)
  listeners.forEach((l) => l())
}

/** For useSyncExternalStore. */
export function subscribeTheme(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Applies the saved theme and follows the device setting while "system" is chosen. */
export function initTheme() {
  apply(getThemePreference())
  darkQuery?.addEventListener('change', () => {
    if (getThemePreference() === 'system') apply('system')
  })
}
