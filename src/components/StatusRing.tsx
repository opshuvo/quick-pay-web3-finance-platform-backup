export type RingState = 'pending' | 'success' | 'failed' | 'wallet'

const COLOR: Record<RingState, string> = { pending: 'var(--cyan)', wallet: 'var(--accent-2)', success: 'var(--success)', failed: 'var(--danger)' }

/**
 * A transaction state mark. It only ever renders a state the caller read from the wallet or the chain: pending turns,
 * success draws itself once, failure shakes once. Motion is stripped by the reduced-motion rule, the shapes remain.
 */
export function StatusRing({ state, size = 36 }: { state: RingState; size?: number }) {
  const color = COLOR[state]
  return (
    <span className={`sr ${state === 'failed' ? 'sr-shake' : ''}`} style={{ width: size, height: size, color }} aria-hidden>
      {state === 'pending' && <span className="sr-halo absolute inset-0 rounded-full" style={{ border: '1.5px solid currentColor' }} />}
      {state === 'success' && <span className="sr-burst absolute inset-0 rounded-full" style={{ border: '2px solid currentColor' }} />}
      <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
        <circle cx="18" cy="18" r="15" stroke="currentColor" strokeOpacity={state === 'success' || state === 'failed' ? 0.9 : 0.22} strokeWidth="2.5" />
        {state === 'pending' && (
          <g className="sr-spin"><path d="M18 3a15 15 0 0 1 15 15" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" /></g>
        )}
        {state === 'wallet' && <path d="M11.5 15.5h13a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Zm0 0V13a2 2 0 0 1 2-2h8m3.5 8.2h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {state === 'success' && <path className="sr-draw sr-draw-late" style={{ ['--len' as string]: 24 }} d="M11.5 18.6l4.4 4.4 8.8-9.6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
        {state === 'failed' && <path className="sr-draw" style={{ ['--len' as string]: 30 }} d="M12.5 12.5l11 11m0-11-11 11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />}
      </svg>
    </span>
  )
}
