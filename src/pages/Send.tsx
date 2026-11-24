import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ScanLine } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AmountInput } from '@/components/AmountInput'
import { PaymentConfirm } from '@/components/PaymentConfirm'
import { Field, Notice, PageHeader } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { useRouter } from '@/hooks/useRouter'
import { useTokenList } from '@/hooks/useTokenList'
import { payTokenInfo } from '@/lib/payTokens'
import { PaymentParseError, validateRecipient, validateTokenAmount } from '@/lib/payments'
import { isPayToken, PAY_TOKENS, type PayToken } from '../../shared/tokens'
import { formatUsdc } from '@/onchain-money'

function check<T>(fn: () => T): { value?: T; error?: string } {
  try {
    return { value: fn() }
  } catch (error) {
    return { error: error instanceof PaymentParseError ? error.message : 'Invalid value.' }
  }
}

export default function Send() {
  const wallet = useArcWallet()
  // Starts the Quick Pay contract check as the screen opens, so the review sheet already has its answer (same cached query).
  useRouter()
  const [params, setParams] = useSearchParams()
  const [to, setTo] = useState(params.get('to') ?? '')
  const [amount, setAmount] = useState(params.get('amount') ?? '')
  const [fromScan] = useState(params.get('src') === 'scan')
  const [symbol, setSymbol] = useState<PayToken>(() => { const t = params.get('token')?.toUpperCase(); return isPayToken(t) ? t : 'USDC' })
  const list = useTokenList()
  const info = payTokenInfo(symbol)
  // A stablecoin is offered only when its own contract answered with the published symbol and decimals.
  const verified = (s: PayToken) => s === 'USDC' || list.tokens.some((t) => t.address.toLowerCase() === payTokenInfo(s).address.toLowerCase())
  const listed = list.tokens.find((t) => t.address.toLowerCase() === info.address.toLowerCase())
  const tokenBalance = symbol === 'USDC' ? wallet.balanceRaw : listed?.balance
  const tokenLoading = symbol === 'USDC' ? wallet.balanceLoading : list.isLoading
  const [touched, setTouched] = useState({ to: false, amount: false })
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)

  // The query string only seeds the form once; it never triggers a payment.
  useEffect(() => {
    if (params.size > 0) setParams({}, { replace: true })
  }, [params, setParams])

  const recipient = useMemo(() => (to ? check(() => validateRecipient(to, wallet.address)) : {}), [to, wallet.address])
  const value = useMemo(() => (amount ? check(() => validateTokenAmount(amount, symbol, info.decimals, tokenBalance)) : {}), [amount, symbol, info.decimals, tokenBalance])
  const ready = Boolean(recipient.value && value.value)

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title={`Send ${symbol}`} subtitle={`Send ${symbol} to any wallet on Arc Mainnet. You review everything before your wallet is asked to sign.`} action={<Link to="/scan" className="btn btn-ghost"><ScanLine className="size-4" /> Scan</Link>} />
      {fromScan && (
        <div className="mb-4">
          <Notice tone="info">Details were filled in from a scanned code. Nothing has been sent. Check the recipient and amount before confirming.</Notice>
        </div>
      )}
      <div className="card space-y-4 p-5">
        <div>
          <span className="label mb-1.5 block">Token</span>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Token to send">
            {PAY_TOKENS.map((s) => {
              const ok = verified(s)
              return (
                <button key={s} type="button" role="radio" aria-checked={symbol === s} disabled={!ok} title={ok ? undefined : `${s} could not be verified on Arc right now`} onClick={() => { setSymbol(s); setAmount('') }} className="chip min-h-[44px] justify-center font-semibold disabled:opacity-40" style={symbol === s ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--blue-soft)' } : undefined}>
                  {s}
                </button>
              )
            })}
          </div>
          {symbol !== 'USDC' && <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>{symbol} is sent as a direct token transfer. The network fee is paid in USDC.</p>}
        </div>
        <Field label="Recipient address" error={touched.to ? recipient.error : null} hint="Paste or type a 0x address on Arc.">
          <input
            className="field mono"
            placeholder="0x…"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={to}
            onChange={(e) => setTo(e.target.value.trim())}
            onBlur={() => setTouched((t) => ({ ...t, to: true }))}
            aria-invalid={Boolean(touched.to && recipient.error)}
          />
        </Field>
        <div>
          <span className="label mb-1.5 block">Amount</span>
          <AmountInput
            value={amount}
            onChange={(v) => {
              setAmount(v)
              setTouched((t) => ({ ...t, amount: true }))
            }}
            symbol={symbol}
            balance={tokenBalance}
            balanceLoading={tokenLoading}
            onMax={() => tokenBalance !== undefined && setAmount(formatUsdc(tokenBalance))}
          />
          {touched.amount && value.error && (
            <p role="alert" className="mt-1.5 text-xs" style={{ color: 'var(--danger)' }}>{value.error}</p>
          )}
        </div>
        {!wallet.isConnected ? (
          <WalletButton className="w-full" />
        ) : (
          <button className="btn btn-primary w-full" disabled={!ready} onClick={() => setOpen(true)}>
            Review payment
          </button>
        )}
      </div>
      {recipient.value && value.value !== undefined && (
        <PaymentConfirm
          open={open}
          onClose={() => {
            setOpen(false)
            if (sent) {
              setSent(false)
              setTo('')
              setAmount('')
              setTouched({ to: false, amount: false })
            }
          }}
          to={recipient.value}
          amount={value.value}
          token={{ ...info, balance: tokenBalance }}
          onSuccess={() => setSent(true)}
        />
      )}
    </div>
  )
}
