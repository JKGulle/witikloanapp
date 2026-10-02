import { useState } from 'react'

export interface ChartSeries {
  key: string
  label: string
  color: string
  values: number[]
}

interface BarChartProps {
  /** Accessible description of what is plotted. */
  title: string
  labels: string[]
  series: ChartSeries[]
  format: (n: number) => string
  /** Compact form for axis ticks (e.g. ₱12K). */
  formatTick?: (n: number) => string
  height?: number
}

const W = 720
const M = { top: 12, right: 8, bottom: 26, left: 58 }
const MAX_BAR = 24
const GAP = 2
const MAX_X_LABELS = 12

/** Rounds up to a clean axis maximum (1, 2, 2.5 or 5 × 10ⁿ). */
function niceMax(v: number): number {
  if (v <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(v))
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= v)!
  return step * pow
}

/** Column with a 4px rounded data end, square on the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

/**
 * Grouped column chart (one or more series on one ₱ or count axis). Each period
 * slot is a focusable hit target that shows a tooltip with every series.
 */
export function BarChart({ title, labels, series, format, formatTick = format, height = 240 }: BarChartProps) {
  const [active, setActive] = useState<number | null>(null)
  const n = labels.length
  const plotW = W - M.left - M.right
  const plotH = height - M.top - M.bottom
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
  const slot = plotW / Math.max(n, 1)
  const barW = Math.max(2, Math.min(MAX_BAR, (slot * 0.72 - GAP * (series.length - 1)) / series.length))
  const groupW = barW * series.length + GAP * (series.length - 1)
  const every = Math.ceil(n / MAX_X_LABELS)
  const y = (v: number) => M.top + plotH - (v / max) * plotH

  return (
    <div className="chart" onPointerLeave={() => setActive(null)}>
      {series.length > 1 && (
        <ul className="chart__legend">
          {series.map((s) => (
            <li key={s.key}>
              <span className="chart__key" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title} className="chart__svg">
        {ticks.map((t) => (
          <g key={t}>
            <line className="chart__grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
            <text className="chart__tick" x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {formatTick(t)}
            </text>
          </g>
        ))}

        {labels.map((label, i) => {
          const x0 = M.left + slot * i
          const gx = x0 + (slot - groupW) / 2
          return (
            <g key={label + i}>
              {active === i && <rect className="chart__hover" x={x0} y={M.top} width={slot} height={plotH} />}
              {series.map((s, si) => {
                const v = s.values[i] ?? 0
                if (v <= 0) return null
                const h = Math.max(1, (v / max) * plotH)
                return <path key={s.key} d={barPath(gx + si * (barW + GAP), y(v), barW, h)} fill={s.color} />
              })}
              {i % every === 0 && (
                <text className="chart__tick" x={x0 + slot / 2} y={height - 8} textAnchor="middle">
                  {label}
                </text>
              )}
              {/* Hit target: the whole slot, bigger than any bar. */}
              <rect
                className="chart__hit"
                x={x0}
                y={M.top}
                width={slot}
                height={plotH}
                tabIndex={0}
                aria-label={`${label}: ${series.map((s) => `${s.label} ${format(s.values[i] ?? 0)}`).join(', ')}`}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            </g>
          )
        })}
        <line className="chart__axis" x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} />
      </svg>

      {active !== null && (
        <div
          className="chart__tooltip"
          style={{ left: `${((M.left + slot * (active + 0.5)) / W) * 100}%` }}
          role="status"
        >
          <span className="chart__tooltip-title">{labels[active]}</span>
          {series.map((s) => (
            <span key={s.key} className="chart__tooltip-row">
              <span className="chart__line-key" style={{ background: s.color }} aria-hidden="true" />
              <strong>{format(s.values[active] ?? 0)}</strong> {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
