import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ScanLine } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AmountInput } from '@/components/AmountInput'
import { PaymentConfirm } from '@/components/PaymentConfirm'
import { Field, Notice, PageHeader } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { PaymentParseError, validateAmount, validateRecipient } from '@/lib/payments'
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
  const [params, setParams] = useSearchParams()
  const [to, setTo] = useState(params.get('to') ?? '')
  const [amount, setAmount] = useState(params.get('amount') ?? '')
  const [fromScan] = useState(params.get('src') === 'scan')
  const [touched, setTouched] = useState({ to: false, amount: false })
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)

  // The query string only seeds the form once; it never triggers a payment.
  useEffect(() => {
    if (params.size > 0) setParams({}, { replace: true })
  }, [params, setParams])

  const recipient = useMemo(() => (to ? check(() => validateRecipient(to, wallet.address)) : {}), [to, wallet.address])
  const value = useMemo(() => (amount ? check(() => validateAmount(amount, wallet.balanceRaw)) : {}), [amount, wallet.balanceRaw])
  const ready = Boolean(recipient.value && value.value)

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Send USDC" subtitle="Send USDC to any wallet on Arc Mainnet. You review everything before your wallet is asked to sign." action={<Link to="/scan" className="btn btn-ghost"><ScanLine className="size-4" /> Scan</Link>} />
      {fromScan && (
        <div className="mb-4">
          <Notice tone="info">Details were filled in from a scanned code. Nothing has been sent. Check the recipient and amount before confirming.</Notice>
        </div>
      )}
      <div className="card space-y-4 p-5">
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
            balance={wallet.balanceRaw}
            balanceLoading={wallet.balanceLoading}
            onMax={() => wallet.balanceRaw !== undefined && setAmount(formatUsdc(wallet.balanceRaw))}
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
          onSuccess={() => setSent(true)}
        />
      )}
    </div>
  )
}
