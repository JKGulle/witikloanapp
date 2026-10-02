import type { HTMLAttributes } from 'react'

type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** Presses into the surface when tapped, for clickable cards. */
  interactive?: boolean
  /** 'accent' renders a soft convex surface for headline figures. */
  tone?: 'default' | 'accent'
}

/** Neumorphic surface: extruded from the background with paired light/dark shadows. */
export function Card({ interactive, tone = 'default', className = '', ...rest }: CardProps) {
  const classes = ['card', interactive && 'card--interactive', tone === 'accent' && 'card--accent', className]
    .filter(Boolean)
    .join(' ')

  return <div className={classes} {...rest} />
}
