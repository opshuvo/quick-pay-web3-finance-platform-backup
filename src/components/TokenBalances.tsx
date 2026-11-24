import { Link } from 'react-router-dom'
import { ArrowLeftRight } from 'lucide-react'
import type { CSSProperties } from 'react'
import { TokenIcon } from '@/components/TokenIcon'
import { Skeleton } from '@/components/ui'
import { useTokenList } from '@/hooks/useTokenList'
import { ARC_USDC } from '@/lib/arc'
import { formatTokenAmount } from '@/lib/swapAmount'

/**
 * Every token Quick Pay lists on Arc, with the wallet's balance of each. Each row is read from the token's own
 * contract (symbol and decimals are cross-checked against Circle's published values, and a token that does not
 * match is left out). No prices are shown because Quick Pay has no verified price source, so nothing here is an estimate.
 * USDC appears once, in its ERC-20 view; it is also the gas token on Arc, so it is never added up with a second "native" balance.
 */
export function TokenBalances({ hidden, style }: { hidden: boolean; style?: CSSProperties }) {
  const list = useTokenList()
  const rows = list.tokens.filter((t) => t.preset)
  const loading = list.isLoading && rows.length === 0

  return (
    <section className="card rise p-4 sm:p-5" style={style} aria-label="Token balances">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="display text-lg font-semibold">Your tokens</h2>
        <Link to="/swap" className="link-hit inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
          <ArrowLeftRight className="size-4" aria-hidden /> Swap
        </Link>
      </div>
      {loading ? (
        <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
      ) : list.readFailed || rows.length === 0 ? (
        <p className="py-4 text-center text-sm" style={{ color: 'var(--muted)' }}>Token balances are unavailable right now. Arc could not be reached.</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {rows.map((t) => (
            <li key={t.address} className="flex min-h-[60px] items-center gap-3 py-2.5">
              <TokenIcon symbol={t.symbol} address={t.address} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{t.symbol}</span>
                <span className="block truncate text-xs" style={{ color: 'var(--muted)' }}>
                  {t.address.toLowerCase() === ARC_USDC.toLowerCase() ? 'Also pays gas on Arc' : t.name}
                </span>
              </span>
              <span className="text-right text-sm font-semibold tabular-nums" aria-label={`${t.symbol} balance`}>
                {hidden ? '••••' : t.balance === undefined ? <span style={{ color: 'var(--muted)' }} title="The balance could not be read">Unavailable</span> : formatTokenAmount(t.balance, t.decimals, { maxFrac: 6 })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
