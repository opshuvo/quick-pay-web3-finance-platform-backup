import { useId } from 'react'

/**
 * Quick Pay mark. A Q built from three ideas: concentric rings (the Circle family), an arch at its core (Arc's
 * geometry) and a swooping tail that points forward (payment in motion). Solid white and soft blue strokes on a navy tile.
 */
export function LogoMark({ size = 36, tile = true }: { size?: number; tile?: boolean }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Quick Pay" className="qp-mark">
      <defs>
        <linearGradient id={`${id}-g`} x1="8" y1="8" x2="58" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#b9ccff" />
        </linearGradient>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#12305f" />
          <stop offset="1" stopColor="#0b1d3a" />
        </linearGradient>
      </defs>
      {tile && (
        <>
          <rect width="64" height="64" rx="18" fill={`url(#${id}-bg)`} />
          <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="17.25" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
        </>
      )}
      {/* Outer ring, open at the lower right where the tail leaves */}
      <g className="qp-outer"><circle cx="32" cy="32" r="21" fill="none" stroke={`url(#${id}-g)`} strokeWidth="4.5" strokeLinecap="round" strokeDasharray="110 22" transform="rotate(62 32 32)" /></g>
      {/* Inner ring: thinner, turning */}
      <g className="qp-ring-inner">
        <circle cx="32" cy="32" r="14" fill="none" stroke={`url(#${id}-g)`} strokeWidth="1.8" strokeLinecap="round" strokeDasharray="58 30" opacity="0.6" />
      </g>
      {/* Arc arch at the core */}
      <path className="qp-arch" d="M25.5 39.5V31.5a6.5 6.5 0 0 1 13 0v8" fill="none" stroke={`url(#${id}-g)`} strokeWidth="3.6" strokeLinecap="round" />
      {/* Q tail */}
      <path className="qp-tail" d="M37.5 41c3.6 0.4 7.6 3.6 12.5 10" fill="none" stroke={`url(#${id}-g)`} strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  )
}

/** The brand lockup: the mark and the wordmark. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="logo-live"><LogoMark size={compact ? 32 : 40} /></span>
      <div className={compact ? 'hidden leading-none min-[400px]:block' : 'leading-none'}>
        <span className="display block text-[1.15rem] font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
          Quick<span className="gradient-text">Pay</span>
        </span>
        {!compact && (
          <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--subtle)' }}>
            USDC on Arc
          </span>
        )}
      </div>
    </div>
  )
}
