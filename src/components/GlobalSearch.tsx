import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isAddress } from 'viem'
import { CornerDownLeft, Search } from 'lucide-react'
import { NAV } from '@/nav'

interface Result {
  key: string
  label: string
  hint: string
  to: string
}

/** Jump to any module, or search history by transaction hash or wallet address. */
export function GlobalSearch({ className = '' }: { className?: string }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const results = useMemo<Result[]>(() => {
    const term = q.trim()
    if (!term) return []
    const out: Result[] = []
    const lower = term.toLowerCase()
    if (/^0x[0-9a-f]{64}$/.test(lower)) out.push({ key: 'tx', label: 'Find this transaction', hint: 'History', to: `/history?q=${lower}` })
    else if (isAddress(term, { strict: false })) {
      out.push({ key: 'addr', label: 'Find payments with this address', hint: 'History', to: `/history?q=${lower}` })
      out.push({ key: 'send', label: 'Send USDC to this address', hint: 'Send', to: `/send?to=${term}` })
    } else if (/^0x[0-9a-f]{3,63}$/.test(lower)) out.push({ key: 'hex', label: `Search history for ${lower}`, hint: 'History', to: `/history?q=${lower}` })
    for (const n of NAV) if (n.label.toLowerCase().includes(lower)) out.push({ key: n.to, label: n.label, hint: 'Go to', to: n.to })
    return out.slice(0, 6)
  }, [q])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const go = (to: string) => {
    void navigate(to)
    setOpen(false)
    setQ('')
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          if (results[0]) go(results[0].to)
        }}
      >
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2" style={{ color: 'var(--subtle)' }} aria-hidden />
        <input
          aria-label="Search pages, transaction hashes or addresses"
          className="field !min-h-[44px] !pl-10"
          placeholder="Search pages, tx hash or address"
          value={q}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        />
      </form>
      {open && q.trim() && (
        <div className="card absolute inset-x-0 top-[calc(100%+6px)] z-50 p-1.5" style={{ background: 'var(--bg-2)' }}>
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm" style={{ color: 'var(--muted)' }}>No matches. Paste a full transaction hash or wallet address.</p>
          ) : (
            <ul role="listbox">
              {results.map((r, i) => (
                <li key={r.key}>
                  <button type="button" onClick={() => go(r.to)} className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm hover:bg-[var(--surface)]">
                    <span className="truncate font-medium">{r.label}</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
                      {r.hint}
                      {i === 0 && <CornerDownLeft className="size-3" aria-hidden />}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
