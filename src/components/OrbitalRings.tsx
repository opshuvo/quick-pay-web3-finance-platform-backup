/**
 * Circle and Arc inspired background for the dashboard: thin rotating rings with a light travelling along each,
 * soft ripples that widen and fade, and a slow sweep of light. It is decoration only (hidden from assistive tech),
 * never receives pointer events, and animates transform and opacity alone. Reduced motion stops it.
 */
export function OrbitalRings({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`orbit ${className}`} data-testid="orbital-rings">
      <span className="orbit-wave" style={{ '--d': '0s' } as React.CSSProperties} />
      <span className="orbit-wave" style={{ '--d': '2.5s' } as React.CSSProperties} />
      <span className="orbit-wave" style={{ '--d': '5s' } as React.CSSProperties} />
      <span className="orbit-flow" />
      <span className="orbit-ring orbit-ring-1"><i className="orbit-dot" /></span>
      <span className="orbit-ring orbit-ring-2"><i className="orbit-dot" /></span>
      <span className="orbit-ring orbit-ring-3"><i className="orbit-dot" /></span>
    </div>
  )
}
