import { formatTokenAmount } from '@/lib/swapAmount'

interface Props {
  value: string
  onChange: (value: string) => void
  balance?: bigint
  /** Decimals of the token the balance is in (default 6, USDC). */
  decimals?: number
  balanceLoading?: boolean
  symbol?: string
  onMax?: () => void
  disabled?: boolean
  id?: string
}

/** Large numeric input. Accepts digits and a single decimal point only. */
export function AmountInput({ value, onChange, balance, decimals = 6, balanceLoading, symbol = 'USDC', onMax, disabled, id = 'amount' }: Props) {
  return (
    <div className="inner p-4">
      <div className="flex items-baseline gap-2">
        <input
          id={id}
          aria-label="Amount"
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          value={value}
          placeholder="0.00"
          onChange={(event) => {
            const next = event.target.value.replace(/,/g, '.')
            if (next === '' || /^\d*\.?\d*$/.test(next)) onChange(next)
          }}
          className="display w-full min-w-0 bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:opacity-40"
          style={{ color: 'var(--ink)' }}
        />
        <span className="text-base font-semibold" style={{ color: 'var(--subtle)' }}>{symbol}</span>
      </div>
      {onMax && (
        <div className="mt-2 flex items-center justify-between text-xs">
          <span style={{ color: 'var(--subtle)' }}>
            {balanceLoading ? 'Loading balance…' : balance === undefined ? 'Balance unavailable' : `Balance ${formatTokenAmount(balance, decimals, { maxFrac: 6 })} ${symbol}`}
          </span>
          <button type="button" disabled={balance === undefined || disabled} onClick={onMax} className="min-h-[32px] px-2 font-semibold disabled:opacity-40" style={{ color: 'var(--accent)' }}>
            Max
          </button>
        </div>
      )}
    </div>
  )
}
