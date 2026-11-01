import { useState } from 'react'
import { isAddress, type Address } from 'viem'
import { ChevronDown, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { TokenIcon } from '@/components/TokenIcon'
import { Notice, Skeleton } from '@/components/ui'
import { useToken } from '@/hooks/useToken'
import type { ListedToken, UnavailableToken } from '@/hooks/useTokenList'
import { shortAddress } from '@/lib/format'
import { formatTokenAmount } from '@/lib/swapAmount'

interface Props {
  label: string
  value: string
  tokens: ListedToken[]
  /** Listed tokens whose data could not be read or did not match the published token. Shown, never selectable. */
  unavailable?: UnavailableToken[]
  loading?: boolean
  /** Token that must not be chosen on this side (the other side of the pair). */
  exclude?: string
  onChange: (address: Address) => void
  onAdd: (address: Address) => void
  onRemove: (address: Address) => void
}

/** Token selector: real icons, names, symbols and on-chain balances. Anything else is added by address and verified first. */
export function TokenPicker({ label, value, tokens, unavailable = [], loading, exclude, onChange, onAdd, onRemove }: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const selected = tokens.find((t) => t.address.toLowerCase() === value.toLowerCase())
  const lookup = useToken(isAddress(text) ? text : undefined)
  const typedInvalid = text !== '' && (!isAddress(text) || lookup.invalid)

  return (
    <>
      <button
        type="button"
        aria-label={`${label}: ${selected?.symbol ?? 'choose a token'}`}
        onClick={() => setOpen(true)}
        className="inner flex min-h-[48px] w-full items-center gap-3 px-3 py-2 text-left"
      >
        {selected ? <TokenIcon symbol={selected.symbol} address={selected.address} size={30} /> : <span className="size-[30px] rounded-full" style={{ background: 'var(--surface-strong)' }} />}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{selected?.symbol ?? (loading ? 'Loading…' : 'Select a token')}</span>
          {selected && <span className="block truncate text-xs" style={{ color: 'var(--muted)' }}>{selected.name}</span>}
        </span>
        {selected?.balance !== undefined && (
          <span className="text-right text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
            Balance<br />
            <span className="font-semibold" style={{ color: 'var(--ink-2)' }}>{formatTokenAmount(selected.balance, selected.decimals, { maxFrac: 4 })}</span>
          </span>
        )}
        <ChevronDown className="size-4 shrink-0" aria-hidden style={{ color: 'var(--muted)' }} />
      </button>

      <ConfirmSheet open={open} onClose={() => setOpen(false)} title={label}>
        {loading && tokens.length === 0 && unavailable.length === 0 ? (
          <Skeleton className="h-32" />
        ) : (
          <ul className="space-y-1" aria-label="Tokens">
            {tokens.map((t) => {
              const blocked = exclude?.toLowerCase() === t.address.toLowerCase()
              return (
                <li key={t.address} className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => { onChange(t.address); setOpen(false) }}
                    className="flex min-h-[56px] flex-1 items-center gap-3 rounded-2xl px-2 text-left hover:bg-[var(--surface-strong)] disabled:opacity-40"
                  >
                    <TokenIcon symbol={t.symbol} address={t.address} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 text-sm font-bold">
                        {t.symbol}
                        {t.preset && <ShieldCheck className="size-3.5" aria-label="Listed by FlowPay" style={{ color: 'var(--success)' }} />}
                      </span>
                      <span className="block truncate text-xs" style={{ color: 'var(--muted)' }}>{t.name} · {shortAddress(t.address, 6, 4)}</span>
                    </span>
                    <span className="text-right text-sm font-semibold tabular-nums">{t.balance !== undefined ? formatTokenAmount(t.balance, t.decimals, { maxFrac: 4 }) : '—'}</span>
                  </button>
                  {!t.preset && (
                    <button type="button" aria-label={`Remove ${t.symbol}`} onClick={() => onRemove(t.address)} className="inline-flex size-10 items-center justify-center rounded-xl" style={{ color: 'var(--muted)' }}>
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              )
            })}
            {unavailable.map(({ token, reason }) => (
              <li key={token.address} className="flex min-h-[56px] items-center gap-3 rounded-2xl px-2 opacity-70" aria-disabled="true">
                <TokenIcon symbol={token.label} address={token.address} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{token.label}</span>
                  <span className="block truncate text-xs" style={{ color: 'var(--muted)' }}>{shortAddress(token.address, 6, 4)}</span>
                </span>
                <span className="text-right text-xs" style={{ color: reason === 'mismatch' ? 'var(--danger)' : 'var(--muted)' }}>
                  {reason === 'mismatch' ? 'Contract did not match. Not offered.' : 'Token data temporarily unavailable'}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
          <label htmlFor="token-address" className="label mb-1.5 block">Add a token by address</label>
          <input id="token-address" className="field mono" placeholder="0x…" value={text} spellCheck={false} onChange={(e) => setText(e.target.value.trim())} />
          {typedInvalid && <p role="alert" className="mt-1.5 text-xs" style={{ color: 'var(--danger)' }}>That is not a valid ERC-20 contract on Arc Mainnet.</p>}
          {lookup.info && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-sm">{lookup.info.symbol} · {lookup.info.decimals} decimals</span>
              <button type="button" className="btn btn-ghost" onClick={() => { onAdd(lookup.info?.address as Address); setText('') }}>
                <Plus className="size-4" aria-hidden /> Add
              </button>
            </div>
          )}
          <div className="mt-3">
            <Notice tone="info">Anyone can create a token with any name. Only trade tokens whose contract address you have verified yourself.</Notice>
          </div>
        </div>
      </ConfirmSheet>
    </>
  )
}
