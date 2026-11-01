import { useId } from 'react'

/**
 * FlowPay mark: a ring (the "Q") with a lightning bolt at its core and a forward-moving tail.
 * The gradient runs cyan to electric blue to violet.
 */
export function LogoMark({ size = 36 }: { size?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="FlowPay">
      <defs>
        <linearGradient id={`${id}-g`} x1="10" y1="8" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2fd4f0" />
          <stop offset="0.5" stopColor="#5b8cff" />
          <stop offset="1" stopColor="#8b6cff" />
        </linearGradient>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0d1a3a" />
          <stop offset="1" stopColor="#050a18" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#${id}-bg)`} />
      <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="17.25" fill="none" stroke="rgba(140,165,255,0.28)" strokeWidth="1.5" />
      <path d="M45.5 41.6A16.5 16.5 0 1 1 48 30" fill="none" stroke={`url(#${id}-g)`} strokeWidth="5" strokeLinecap="round" />
      <path d="M34.5 17.5 24.5 33h7l-3 12.5L40 28.5h-7.2z" fill={`url(#${id}-g)`} />
      <path d="M41 43l9.5 9.5" stroke={`url(#${id}-g)`} strokeWidth="5" strokeLinecap="round" />
    </svg>
  )
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={compact ? 32 : 38} />
      <div className="leading-none">
        <span className="display block text-[1.15rem] font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
          Flow<span className="gradient-text">Pay</span>
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
