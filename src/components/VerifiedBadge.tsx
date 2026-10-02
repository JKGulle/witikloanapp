/** Check-mark seal shown next to a borrower whose identity (KYC) has been verified. */
export function VerifiedBadge({ size = 'md', label = false }: { size?: 'sm' | 'md' | 'lg'; label?: boolean }) {
  return (
    <span className={`verified verified--${size}`} title="Identity verified" role="img" aria-label="Identity verified">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {/* scalloped seal */}
        <path
          className="verified__seal"
          d="M12 1.6l2.3 1.7 2.8-.4 1.1 2.6 2.6 1.1-.4 2.8 1.7 2.3-1.7 2.3.4 2.8-2.6 1.1-1.1 2.6-2.8-.4L12 22.4l-2.3-1.7-2.8.4-1.1-2.6-2.6-1.1.4-2.8L1.9 12l1.7-2.3-.4-2.8 2.6-1.1 1.1-2.6 2.8.4z"
        />
        <path className="verified__check" d="m7.6 12.3 3 3 5.8-6.2" />
      </svg>
      {label && <span className="verified__label">Verified</span>}
    </span>
  )
}
