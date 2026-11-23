import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDownUp, Check, ChevronDown, Search } from 'lucide-react'
import NetworkArbitrumOne from '@web3icons/react/icons/networks/NetworkArbitrumOne'
import NetworkAvalanche from '@web3icons/react/icons/networks/NetworkAvalanche'
import NetworkBase from '@web3icons/react/icons/networks/NetworkBase'
import NetworkBinanceSmartChain from '@web3icons/react/icons/networks/NetworkBinanceSmartChain'
import NetworkEthereum from '@web3icons/react/icons/networks/NetworkEthereum'
import NetworkLinea from '@web3icons/react/icons/networks/NetworkLinea'
import NetworkOptimism from '@web3icons/react/icons/networks/NetworkOptimism'
import NetworkPolygon from '@web3icons/react/icons/networks/NetworkPolygon'
import NetworkArc from '@web3icons/react/icons/networks/NetworkArc'
import NetworkBlast from '@web3icons/react/icons/networks/NetworkBlast'
import NetworkCelo from '@web3icons/react/icons/networks/NetworkCelo'
import NetworkGnosis from '@web3icons/react/icons/networks/NetworkGnosis'
import NetworkInk from '@web3icons/react/icons/networks/NetworkInk'
import NetworkMonad from '@web3icons/react/icons/networks/NetworkMonad'
import NetworkPlasma from '@web3icons/react/icons/networks/NetworkPlasma'
import NetworkScroll from '@web3icons/react/icons/networks/NetworkScroll'
import NetworkSonic from '@web3icons/react/icons/networks/NetworkSonic'
import NetworkUnichain from '@web3icons/react/icons/networks/NetworkUnichain'
import { ProviderLogo, type ProviderId } from '@/components/ProviderLogo'
import { TokenIcon } from '@/components/TokenIcon'
import { usePresence } from '@/hooks/usePresence'
import { useChainLogos } from '@/hooks/useChainLogos'
import { Skeleton } from '@/components/ui'
import { ARC_CHAIN_ID } from '@/lib/arc'
import { formatTokenAmount } from '@/lib/swapAmount'

const NETWORK_ICONS: Record<number, typeof NetworkEthereum> = {
  1: NetworkEthereum,
  10: NetworkOptimism,
  56: NetworkBinanceSmartChain,
  137: NetworkPolygon,
  8453: NetworkBase,
  42161: NetworkArbitrumOne,
  43114: NetworkAvalanche,
  59144: NetworkLinea,
  100: NetworkGnosis,
  130: NetworkUnichain,
  143: NetworkMonad,
  146: NetworkSonic,
  9745: NetworkPlasma,
  42220: NetworkCelo,
  57073: NetworkInk,
  81457: NetworkBlast,
  534352: NetworkScroll,
}

/** A published chain logo, with a neutral initial if the image cannot load. */
function RemoteLogo({ url, name, size }: { url: string; name: string; size: number }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <Initial name={name} size={size} />
  return <img src={url} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="shrink-0 rounded-full bg-[var(--surface-muted)] object-contain" style={{ width: size, height: size }} />
}

function Initial({ name, size }: { name: string; size: number }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--surface-strong)] font-bold text-[var(--ink)]" style={{ width: size, height: size, fontSize: size * 0.5 }}>
      {name[0]?.toUpperCase() ?? '?'}
    </span>
  )
}

/**
 * The official logo of every network the Bridge lists, in one consistent round badge. Arc, Ethereum, Optimism, Polygon,
 * Arbitrum, Base and the other well-known chains use their bundled brand icon (instant, no request); every other chain
 * uses the logo its bridge provider publishes; only if that cannot load is a neutral initial shown. Arc never shows the
 * Quick Pay mark.
 */
export function ChainIcon({ chainId, name, size = 20 }: { chainId: number; name: string; size?: number }) {
  const logos = useChainLogos()
  const remote = logos.get(chainId)
  const Icon = chainId === ARC_CHAIN_ID ? NetworkArc : NETWORK_ICONS[chainId]
  return (
    <span className="chain-badge" style={{ width: size, height: size }} role="img" aria-label={`${name} logo`}>
      {Icon ? <Icon variant="branded" size={size} /> : remote ? <RemoteLogo url={remote} name={name} size={size} /> : <Initial name={name} size={size} />}
    </span>
  )
}

export interface ChainOption { chainId: number; name: string }

/**
 * Network picker with the logo of every network beside its name. A real listbox: arrow keys move, Enter chooses,
 * Escape closes, and long lists (LI.FI) get a search box. The chosen network carries a check mark, a tinted row and an
 * accent edge so the selection is unmistakable.
 */
function ChainSelect({ label, value, options, onChange }: { label: 'FROM' | 'TO'; value: number; options: ChainOption[]; onChange: (chainId: number) => void }) {
  const [open, setOpen] = useState(false)
  const menu = usePresence(open)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const uid = useId()
  const current = options.find((o) => o.chainId === value)
  const name = current?.name ?? `Chain ${value}`
  const filtered = useMemo(() => options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase())), [options, query])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function show() {
    setQuery('')
    setActive(Math.max(0, options.findIndex((o) => o.chainId === value)))
    setOpen(true)
    // Long lists open with the search focused; short ones keep focus on the list so the arrow keys work at once.
    requestAnimationFrame(() => search.current?.focus())
  }
  function choose(o: ChainOption) {
    setOpen(false)
    if (o.chainId !== value) onChange(o.chainId)
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(filtered.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && filtered[active]) { e.preventDefault(); choose(filtered[active]) }
  }

  return (
    <div ref={root} className="relative" onKeyDown={open ? onKey : undefined}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label === 'FROM' ? 'From' : 'To'} network: ${name}`} onClick={() => (open ? setOpen(false) : show())} className="net-chip">
        <span key={value} className="chain-swap inline-flex min-w-0 items-center gap-2.5">
          <ChainIcon chainId={value} name={name} size={26} />
          <span className="min-w-0 truncate font-semibold">{name}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-[var(--muted)] transition-transform duration-200" style={{ transform: open ? 'rotate(180deg)' : undefined }} aria-hidden />
      </button>
      {menu.mounted && (
        <div data-state={menu.state} className="net-menu card pop" style={{ background: 'var(--bg-2)' }}>
          {options.length > 7 && (
            <label className="relative block border-b p-2" style={{ borderColor: 'var(--border)' }}>
              <span className="sr-only">Search networks</span>
              <Search className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-[var(--subtle)]" aria-hidden />
              <input ref={search} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0) }} placeholder="Search networks" className="field !min-h-[40px] !pl-9" />
            </label>
          )}
          <ul role="listbox" aria-label={`${label === 'FROM' ? 'From' : 'To'} network`} aria-activedescendant={filtered[active] ? `${uid}-${filtered[active].chainId}` : undefined} tabIndex={options.length > 7 ? -1 : 0} ref={(el) => { if (open && options.length <= 7) el?.focus({ preventScroll: true }) }} className="max-h-72 overflow-y-auto p-1.5 outline-none">
            {filtered.length === 0 && <li className="px-3 py-4 text-center text-sm text-[var(--muted)]">No network matches.</li>}
            {filtered.map((o, i) => {
              const selected = o.chainId === value
              return (
                <li key={o.chainId} id={`${uid}-${o.chainId}`} role="option" aria-selected={selected} data-selected={selected} data-active={i === active} onMouseEnter={() => setActive(i)} onClick={() => choose(o)} className="net-option">
                  <ChainIcon chainId={o.chainId} name={o.name} size={28} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{o.name}</span>
                  {selected && <Check className="net-check size-4 shrink-0 text-[var(--accent)]" aria-hidden />}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/** FROM / TO card. The selected network is shown with its logo and an accent edge. */
export function NetworkRow({ label, value, options, onChange, loading, className = '' }: { label: 'FROM' | 'TO'; value: number; options: ChainOption[]; onChange: (chainId: number) => void; loading?: boolean; className?: string }) {
  return (
    <div className={`inner net-card flex items-center justify-between gap-3 p-3 ${className}`}>
      <span className="label">{label}</span>
      {loading ? <Skeleton className="h-10 w-44" /> : <ChainSelect label={label} value={value} options={options} onChange={onChange} />}
    </div>
  )
}

/** Source and destination side by side, each with its logo, and the provider that carries the transfer. */
export function RoutePair({ fromId, fromName, toId, toName, provider }: { fromId: number; fromName: string; toId: number; toName: string; provider?: ProviderId }) {
  return (
    <div className="mb-3" aria-label={`From ${fromName} to ${toName}`}>
      <div className="route-pair">
        <div className="route-end">
          <ChainIcon chainId={fromId} name={fromName} size={32} />
          <span className="min-w-0"><span className="label block">FROM</span><span className="block truncate text-sm font-semibold">{fromName}</span></span>
        </div>
        <span className="route-arrow" aria-hidden />
        <div className="route-end" data-end="to">
          <span className="min-w-0"><span className="label block">TO</span><span className="block truncate text-sm font-semibold">{toName}</span></span>
          <ChainIcon chainId={toId} name={toName} size={32} />
        </div>
      </div>
      {provider && (
        <p className="mt-3 flex items-center justify-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
          via <ProviderLogo id={provider} size={18} /> <span className="font-semibold" style={{ color: 'var(--ink-2)' }}>{provider === 'lifi' ? 'LI.FI' : provider === 'circle' ? 'Circle' : 'Across'}</span>
        </p>
      )}
    </div>
  )
}

export function ReverseButton({ onClick, disabled, title }: { onClick: () => void; disabled?: boolean; title: string }) {
  return (
    <div className="relative z-10 -my-2 flex justify-center">
      <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label="Reverse networks" className="group min-h-[40px] min-w-[40px] rounded-full border border-[var(--border)] bg-[var(--surface-strong)] p-2 shadow-md transition-all duration-200 hover:bg-[var(--accent)] hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 disabled:hover:bg-[var(--surface-strong)]">
        <ArrowDownUp size={16} className="mx-auto text-[var(--muted)] group-hover:text-[var(--accent-ink)]" aria-hidden />
      </button>
    </div>
  )
}

/** YOU BRIDGE panel: digits and one decimal point only. The balance is the live on-chain balance on the source chain. */
export function BridgeAmount({ value, onChange, balance, decimals, symbol, balanceLoading, onMax }: { value: string; onChange: (v: string) => void; balance?: bigint; decimals?: number; symbol?: string; balanceLoading?: boolean; onMax?: () => void }) {
  const sym = symbol ?? ''
  return (
    <div className="inner p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="label">YOU BRIDGE</span>
        <span className="text-xs text-[var(--muted)]">
          {balanceLoading ? 'Loading balance…' : balance === undefined || decimals === undefined ? 'Balance unavailable' : `Balance: ${formatTokenAmount(balance, decimals, { maxFrac: 6 })} ${sym}`}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <input
          id="bridge-amount"
          aria-label="Amount to bridge"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={value}
          onChange={(e) => {
            const next = e.target.value.replace(/,/g, '.')
            if (next === '' || /^\d*\.?\d*$/.test(next)) onChange(next)
          }}
          className="display w-full min-w-0 bg-transparent text-2xl font-bold tabular-nums text-[var(--ink)] outline-none placeholder:text-[var(--subtle)]"
        />
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" disabled={!onMax} onClick={onMax} className="min-h-[32px] rounded bg-[var(--glow)] px-2 py-1 text-xs font-semibold text-[var(--accent)] transition-all duration-200 hover:bg-[var(--surface-strong)] active:scale-95 disabled:opacity-40">MAX</button>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ink)]">{sym && <TokenIcon symbol={sym} size={22} />}{sym}</span>
        </div>
      </div>
    </div>
  )
}
