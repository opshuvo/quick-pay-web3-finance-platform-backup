import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, Bell } from 'lucide-react'
import { useNotifications } from '@/hooks/useNotifications'
import { useArcWallet } from '@/hooks/useArcWallet'
import { displayUsdc, formatRelative, shortAddress } from '@/lib/format'

export function NotificationsMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { isConnected } = useArcWallet()
  const { items, unread, markRead, isLoading, isError } = useNotifications()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} new` : 'Notifications'}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v)
          if (!open) markRead()
        }}
        className="btn btn-ghost relative !min-h-[44px] !px-3"
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 && <span className="pulse-dot absolute right-2 top-2 size-2 rounded-full" style={{ background: 'var(--cyan)', boxShadow: '0 0 8px var(--cyan)' }} />}
      </button>
      {open && (
        <div className="card absolute right-0 top-[calc(100%+8px)] z-50 w-[min(360px,calc(100vw-2rem))] p-2" style={{ background: 'var(--bg-2)' }} role="dialog" aria-label="Notifications">
          <p className="px-3 pb-1 pt-2 text-sm font-semibold">Notifications</p>
          {!isConnected ? (
            <p className="px-3 py-6 text-center text-sm" style={{ color: 'var(--muted)' }}>Connect a wallet to see incoming payments.</p>
          ) : isLoading ? (
            <p className="px-3 py-6 text-center text-sm" style={{ color: 'var(--muted)' }}>Loading…</p>
          ) : isError ? (
            <p className="px-3 py-6 text-center text-sm" style={{ color: 'var(--muted)' }}>Notifications are unavailable while the history service is offline.</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm" style={{ color: 'var(--muted)' }}>No incoming payments found yet.</p>
          ) : (
            <ul>
              {items.slice(0, 6).map((r) => (
                <li key={`${r.txHash}-${r.logIndex}`}>
                  <Link to={`/history?q=${r.txHash}`} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-[var(--surface)]">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--surface-strong)', color: 'var(--success)' }}>
                      <ArrowDownLeft className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block truncate font-semibold">+{displayUsdc(BigInt(r.amount))} USDC</span>
                      <span className="block truncate text-xs" style={{ color: 'var(--muted)' }}>from {shortAddress(r.from)} · {formatRelative(r.timestamp)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link to="/received" onClick={() => setOpen(false)} className="mt-1 block rounded-xl px-3 py-2.5 text-center text-sm font-semibold" style={{ color: 'var(--accent)' }}>
            View all received
          </Link>
        </div>
      )}
    </div>
  )
}
