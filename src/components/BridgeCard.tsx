import { ArrowDownUp, ChevronDown } from 'lucide-react'
import NetworkArbitrumOne from '@web3icons/react/icons/networks/NetworkArbitrumOne'
import NetworkAvalanche from '@web3icons/react/icons/networks/NetworkAvalanche'
import NetworkBase from '@web3icons/react/icons/networks/NetworkBase'
import NetworkBinanceSmartChain from '@web3icons/react/icons/networks/NetworkBinanceSmartChain'
import NetworkEthereum from '@web3icons/react/icons/networks/NetworkEthereum'
import NetworkLinea from '@web3icons/react/icons/networks/NetworkLinea'
import NetworkOptimism from '@web3icons/react/icons/networks/NetworkOptimism'
import NetworkPolygon from '@web3icons/react/icons/networks/NetworkPolygon'
import { LogoMark } from '@/components/Logo'
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
}

/** Real brand icon for the chains Quick Pay knows, the Arc mark for Arc, and a neutral initial for anything else. */
export function ChainIcon({ chainId, name, size = 20 }: { chainId: number; name: string; size?: number }) {
  if (chainId === ARC_CHAIN_ID) return <LogoMark size={size} />
  const Icon = NETWORK_ICONS[chainId]
  if (Icon) return <Icon variant="branded" size={size} />
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-slate-600 font-bold text-white" style={{ width: size, height: size, fontSize: size * 0.5 }}>
      {name[0]?.toUpperCase() ?? '?'}
    </span>
  )
}

export interface ChainOption { chainId: number; name: string }

/** FROM / TO row. The chip is a real native select laid over a styled button, so it works with keyboard, screen readers and phones. */
export function NetworkRow({ label, value, options, onChange, loading, className = '' }: { label: 'FROM' | 'TO'; value: number; options: ChainOption[]; onChange: (chainId: number) => void; loading?: boolean; className?: string }) {
  const current = options.find((o) => o.chainId === value)
  const name = current?.name ?? `Chain ${value}`
  return (
    <div className={`flex items-center justify-between rounded-xl border border-slate-700/40 bg-slate-800/50 p-3 ${className}`}>
      <span className="text-xs font-semibold text-slate-400">{label}</span>
      {loading ? (
        <Skeleton className="h-9 w-36" />
      ) : (
        <div className="relative">
          <span className="flex items-center gap-2 rounded-lg bg-slate-700/60 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700">
            <ChainIcon chainId={value} name={name} />
            <span>{name}</span>
            <ChevronDown className="size-4 text-slate-400" aria-hidden />
          </span>
          <select aria-label={`${label === 'FROM' ? 'From' : 'To'} network`} value={value} onChange={(e) => onChange(Number(e.target.value))} className="absolute inset-0 size-full cursor-pointer opacity-0">
            {options.map((o) => <option key={o.chainId} value={o.chainId} className="text-slate-900">{o.name}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

export function ReverseButton({ onClick, disabled, title }: { onClick: () => void; disabled?: boolean; title: string }) {
  return (
    <div className="relative z-10 -my-2 flex justify-center">
      <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label="Reverse networks" className="group min-h-[40px] min-w-[40px] rounded-full border border-slate-700 bg-slate-800 p-2 shadow-md transition-all duration-200 hover:bg-indigo-600 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 disabled:hover:bg-slate-800">
        <ArrowDownUp size={16} className="mx-auto text-slate-300 group-hover:text-white" aria-hidden />
      </button>
    </div>
  )
}

/** YOU BRIDGE panel: digits and one decimal point only. The balance is the live on-chain balance on the source chain. */
export function BridgeAmount({ value, onChange, balance, decimals, symbol, balanceLoading, onMax }: { value: string; onChange: (v: string) => void; balance?: bigint; decimals?: number; symbol?: string; balanceLoading?: boolean; onMax?: () => void }) {
  const sym = symbol ?? ''
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-slate-400">YOU BRIDGE</span>
        <span className="text-xs text-slate-400">
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
          className="display w-full min-w-0 bg-transparent text-2xl font-bold tabular-nums text-white outline-none placeholder:text-slate-600"
        />
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" disabled={!onMax} onClick={onMax} className="min-h-[32px] rounded bg-indigo-500/20 px-2 py-1 text-xs font-semibold text-indigo-400 transition-all duration-200 hover:bg-indigo-500/30 active:scale-95 disabled:opacity-40">MAX</button>
          <span className="text-sm font-semibold text-white">{sym}</span>
        </div>
      </div>
    </div>
  )
}
