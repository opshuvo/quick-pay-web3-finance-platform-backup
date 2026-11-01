import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, Share2 } from 'lucide-react'
import { QrCode } from '@/components/QrCode'
import { AmountInput } from '@/components/AmountInput'
import { CopyButton, EmptyState, ExplorerLink, Notice, PageHeader } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { arcAddressUrl } from '@/lib/arc'
import { buildUsdcUri, PaymentParseError, validateAmount } from '@/lib/payments'

export default function Receive() {
  const { address, isConnected } = useArcWallet()
  const [withAmount, setWithAmount] = useState(false)
  const [amount, setAmount] = useState('')

  const parsed = useMemo(() => {
    if (!withAmount || !amount) return { raw: undefined as bigint | undefined, error: null as string | null }
    try {
      return { raw: validateAmount(amount), error: null }
    } catch (e) {
      return { raw: undefined, error: e instanceof PaymentParseError ? e.message : 'Invalid amount' }
    }
  }, [withAmount, amount])

  if (!isConnected || !address) {
    return (
      <div className="mx-auto max-w-lg">
        <PageHeader title="Receive USDC" subtitle="Share your address or QR code to get paid on Arc Mainnet." />
        <div className="card"><EmptyState title="Connect a wallet" body="Your receiving address is your wallet address. Connect to display it." action={<WalletButton />} /></div>
      </div>
    )
  }

  const qrValue = withAmount && parsed.raw ? buildUsdcUri(address, parsed.raw) : address

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Receive USDC" subtitle="Anyone can send USDC on Arc Mainnet to this address. Only send USDC on Arc to it." />
      <div className="card p-5">
        <div className="flex flex-col items-center gap-4">
          <QrCode value={qrValue} label="Your receiving address as a QR code" />
          <div className="w-full">
            <span className="label">Your Arc address</span>
            <div className="inner mt-1.5 flex items-center justify-between gap-2 px-3 py-2">
              <span className="mono break-all text-sm">{address}</span>
              <CopyButton value={address} label="Copy address" />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <ExplorerLink href={arcAddressUrl(address)}>View on explorer</ExplorerLink>
            {typeof navigator.share === 'function' && (
              <button className="btn btn-ghost" onClick={() => void navigator.share({ title: 'My Quick Pay address', text: address }).catch(() => undefined)}>
                <Share2 className="size-4" /> Share
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm font-semibold">
            <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={withAmount} onChange={(e) => setWithAmount(e.target.checked)} />
            Include a requested amount in the QR
          </label>
          {withAmount && (
            <div className="mt-3 space-y-2">
              <AmountInput value={amount} onChange={setAmount} />
              {parsed.error && <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{parsed.error}</p>}
              <Notice tone="info">The QR carries a standard USDC payment link for Arc. The payer still reviews and confirms in their own wallet.</Notice>
            </div>
          )}
        </div>
      </div>
      <Link to="/requests" className="btn btn-ghost mt-4 w-full">
        <FileText className="size-4" /> Need a trackable invoice? Create a payment request
      </Link>
    </div>
  )
}
