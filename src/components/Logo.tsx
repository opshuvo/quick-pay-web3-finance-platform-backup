import { useId } from 'react'

/**
 * Quick Pay mark. Still a Q on a deep navy tile, now with both of its parents in it: a Circle-style ring (the outer
 * ring and the small node where the tail ends) and Arc's layered arch at the core. The tail points forward, payment
 * in motion, and a spark sits on the ring so it can orbit when the mark is animated.
 */
export function LogoMark({ size = 36, tile = true }: { size?: number; tile?: boolean }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Quick Pay" className="qp-mark">
      <defs>
        <linearGradient id={`${id}-g`} x1="8" y1="8" x2="58" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#a9c4ff" />
        </linearGradient>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#133a74" />
          <stop offset="1" stopColor="#081631" />
        </linearGradient>
        <radialGradient id={`${id}-lit`} cx="26%" cy="20%" r="70%">
          <stop stopColor="#4f8cff" stopOpacity="0.38" />
          <stop offset="1" stopColor="#4f8cff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {tile && (
        <>
          <rect width="64" height="64" rx="18" fill={`url(#${id}-bg)`} />
          <rect width="64" height="64" rx="18" fill={`url(#${id}-lit)`} />
          <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="17.25" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" />
        </>
      )}
      {/* Circle: the outer ring, open at the lower right where the tail leaves */}
      <g className="qp-outer"><circle cx="32" cy="32" r="21" fill="none" stroke={`url(#${id}-g)`} strokeWidth="4.4" strokeLinecap="round" strokeDasharray="108 24" transform="rotate(62 32 32)" /></g>
      {/* Arc: two nested arches at the core */}
      <path className="qp-arch" d="M23.5 40V32a8.5 8.5 0 0 1 17 0v8" fill="none" stroke="#7fb0ff" strokeWidth="3.1" strokeLinecap="round" />
      <path className="qp-arch" d="M28.4 40V32a3.6 3.6 0 0 1 7.2 0v8" fill="none" stroke="#38d3ee" strokeWidth="2.6" strokeLinecap="round" />
      {/* The tail, ending in a small ring: a payment node */}
      <path className="qp-tail" d="M37.5 41c3.4 0.5 7 2.8 10 7" fill="none" stroke={`url(#${id}-g)`} strokeWidth="4.2" strokeLinecap="round" />
      <circle className="qp-node" cx="51" cy="52" r="3.2" fill="#081631" stroke={`url(#${id}-g)`} strokeWidth="2.2" />
      {/* A spark of light on the ring */}
      <circle className="qp-spark" cx="45.5" cy="15.9" r="2.1" fill="#38d3ee" />
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
            USDC payments on Arc
          </span>
        )}
      </div>
    </div>
  )
}
