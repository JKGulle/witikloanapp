import { useEffect, useId, useMemo } from 'react'

interface KycUploadTileProps {
  label: string
  hint: string
  file: File | null
  onChange: (file: File | null) => void
  /** 'user' opens the front camera on phones (selfie); omitted lets people pick from the gallery too. */
  capture?: 'user' | 'environment'
  optional?: boolean
}

export function KycUploadTile({ label, hint, file, onChange, capture, optional }: KycUploadTileProps) {
  const inputId = useId()
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview],
  )

  return (
    <div className="upload-tile">
      <label htmlFor={inputId} className={file ? 'upload-tile__drop has-file' : 'upload-tile__drop'}>
        {preview ? (
          <img src={preview} alt={`${label} preview`} />
        ) : (
          <span className="upload-tile__placeholder">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            <span>{file ? 'Change photo' : 'Add photo'}</span>
          </span>
        )}
      </label>
      <input
        id={inputId}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture={capture}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      <div className="upload-tile__text">
        <strong>
          {label}
          {optional && <span className="muted"> (optional)</span>}
        </strong>
        <span className="muted small">{hint}</span>
      </div>
    </div>
  )
}
