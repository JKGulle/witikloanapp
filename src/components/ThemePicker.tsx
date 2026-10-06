import { useSyncExternalStore, type ReactNode } from 'react'
import { getThemePreference, setThemePreference, subscribeTheme, type ThemePreference } from '../lib/theme.ts'
import { DeviceIcon, MoonIcon, SunIcon } from './icons.tsx'
import { Card } from './Card.tsx'

const OPTIONS: { value: ThemePreference; label: string; Icon: () => ReactNode }[] = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
  { value: 'system', label: 'Match device', Icon: DeviceIcon },
]

/** Lets the borrower choose the app theme. Saved on this device only. */
export function ThemePicker() {
  const current = useSyncExternalStore(subscribeTheme, getThemePreference)

  return (
    <Card className="stack">
      <div className="stack-xs">
        <h2 className="h3" id="theme-heading">
          Appearance
        </h2>
        <p className="muted small">Choose how Witik looks on this device.</p>
      </div>
      <div className="theme-options" role="radiogroup" aria-labelledby="theme-heading">
        {OPTIONS.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={current === value}
            className="theme-option"
            onClick={() => setThemePreference(value)}
          >
            <span className={`theme-option__swatch is-${value}`} aria-hidden="true">
              <Icon />
            </span>
            <span className="theme-option__label">{label}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}
