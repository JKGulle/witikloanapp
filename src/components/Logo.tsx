const LOGO_SRC = '/witik-icon.png'

/**
 * Witik coin logo. At header size the coin's lettering is too small to read,
 * so the wordmark sits beside it; the large variant shows the coin on its own.
 */
export function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  if (size === 'lg') {
    return (
      <span className="logo logo--lg">
        <img className="logo__coin" src={LOGO_SRC} alt="Witik" width={112} height={112} />
      </span>
    )
  }

  return (
    <span className="logo logo--md">
      <img className="logo__coin" src={LOGO_SRC} alt="" width={40} height={40} />
      <span className="logo__word">witik</span>
    </span>
  )
}
