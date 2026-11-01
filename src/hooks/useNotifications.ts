import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useArcWallet } from '@/hooks/useArcWallet'
import { DEFAULT_FILTERS, useHistory, type HistoryRow } from '@/hooks/useHistory'
import { displayUsdc, shortAddress } from '@/lib/format'
import { usePrefs } from '@/lib/prefs'

const seenKey = (address: string) => `quickpay.notifications.seen.${address.toLowerCase()}`

function readSeen(address: string): number {
  const stored = Number(localStorage.getItem(seenKey(address)) ?? 0)
  if (stored) return stored
  const now = Date.now()
  localStorage.setItem(seenKey(address), String(now))
  return now
}

/**
 * In-app notifications built only from verified incoming USDC transfers returned by the history
 * service. Nothing is simulated: with no indexed incoming payments the list is empty.
 */
export function useNotifications() {
  const { address } = useArcWallet()
  const prefs = usePrefs()
  const query = useHistory(address, { ...DEFAULT_FILTERS, direction: 'in', pageSize: 8 }, { background: true })
  const items: HistoryRow[] = query.data?.rows ?? []
  const [seenOverride, setSeenOverride] = useState<{ address: string; at: number } | null>(null)
  const announced = useRef<Set<string> | null>(null)

  // The "seen" marker lives in localStorage; the first visit starts at "now" so the existing backlog is not flagged unread.
  const seenAt = useMemo(() => (address ? readSeen(address) : 0), [address])
  const effectiveSeenAt = seenOverride && seenOverride.address === address ? seenOverride.at : seenAt

  useEffect(() => {
    announced.current = null
  }, [address])

  // Toast for payments that arrive while the app is open (never for the initial backlog).
  useEffect(() => {
    if (!query.data) return
    const hashes = new Set(query.data.rows.map((r) => `${r.txHash}-${r.logIndex}`))
    if (announced.current === null) {
      announced.current = hashes
      return
    }
    const known = announced.current
    for (const row of query.data.rows) {
      const key = `${row.txHash}-${row.logIndex}`
      if (!known.has(key) && row.direction === 'in' && prefs.notifyIncoming) {
        toast.success(`Received ${displayUsdc(BigInt(row.amount))} USDC from ${shortAddress(row.from)}`)
      }
    }
    announced.current = hashes
  }, [query.data, prefs.notifyIncoming])

  const unread = items.filter((r) => new Date(r.timestamp).getTime() > effectiveSeenAt && r.direction === 'in').length
  const markRead = useCallback(() => {
    if (!address) return
    const now = Date.now()
    localStorage.setItem(seenKey(address), String(now))
    setSeenOverride({ address, at: now })
  }, [address])

  return { items: items.filter((r) => r.direction === 'in'), unread, markRead, isLoading: query.isLoading, isError: query.isError }
}
