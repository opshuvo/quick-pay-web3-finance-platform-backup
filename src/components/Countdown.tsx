import { useNow } from '@/hooks/useNow'

/**
 * Whole seconds left until `deadline`. It owns the one-second tick, so only these few characters re-render each second
 * and the surrounding screen stays still.
 */
export function Countdown({ deadline, round = 'ceil', before = '', after = 's' }: { deadline: number; round?: 'ceil' | 'floor'; before?: string; after?: string }) {
  const now = useNow(1000)
  const left = Math.max(0, (round === 'ceil' ? Math.ceil : Math.floor)((deadline - now) / 1000))
  return <span className="tabular-nums">{before}{left}{after}</span>
}
