export function Loader({ label = 'Loading', fullscreen = false }: { label?: string; fullscreen?: boolean }) {
  return (
    <div className={fullscreen ? 'loader loader--fullscreen' : 'loader'} role="status">
      <span className="loader__ring" aria-hidden="true" />
      <span className="loader__label">{label}</span>
    </div>
  )
}
