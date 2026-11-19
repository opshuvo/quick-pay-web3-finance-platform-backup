import { useId } from 'react'

/**
 * Quick Pay mark. A Q built from three ideas: concentric rings (the Circle family), an arch at its core (Arc's
 * geometry) and a swooping tail that points forward (payment in motion). The gradient runs cyan, electric blue, violet.
 * `animated` slowly turns the inner ring and breathes the glow; it is still when reduced motion is on.
 */
export function LogoMark({ size = 36, animated = false, tile = true, hero = false }: { size?: number; animated?: boolean; tile?: boolean; hero?: boolean }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Quick Pay" className={hero ? 'qp-mark qp-mark-hero' : animated ? 'qp-mark qp-mark-live' : 'qp-mark'}>
      <defs>
        <linearGradient id={`${id}-g`} x1="8" y1="8" x2="58" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22d3ee" />
          <stop offset="0.5" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0b1634" />
          <stop offset="1" stopColor="#02050d" />
        </linearGradient>
      </defs>
      {tile && (
        <>
          <rect width="64" height="64" rx="18" fill={`url(#${id}-bg)`} />
          <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="17.25" fill="none" stroke="rgba(120,160,255,0.3)" strokeWidth="1.5" />
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

/** The brand lockup. `animated` is the full animation: reveal, pulse rings, turning ring, flicking tail and a flowing wordmark. */
export function Logo({ compact = false, animated = false }: { compact?: boolean; animated?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {animated ? <LogoHero size={compact ? 36 : 42} compact /> : <LogoMark size={compact ? 32 : 40} />}
      <div className={compact ? 'hidden leading-none min-[400px]:block' : 'leading-none'}>
        <span className="display block text-[1.15rem] font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
          Quick<span className={animated ? 'gradient-text gradient-flow' : 'gradient-text'}>Pay</span>
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

/**
 * The dashboard's animated mark: it reveals itself, two soft rings pulse outward like a payment leaving, the inner ring
 * turns and the tail flicks forward. Only transform and opacity move, so it is cheap on phones.
 */
export function LogoHero({ size = 56, compact = false }: { size?: number; compact?: boolean }) {
  return (
    <span className="logo-hero" data-compact={compact} style={{ width: size, height: size }} aria-hidden>
      <span className="logo-pulse" />
      <span className="logo-pulse" data-b />
      <LogoMark size={size} hero />
    </span>
  )
}
