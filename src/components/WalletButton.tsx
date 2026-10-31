import { ConnectKitButton } from 'connectkit'
import { Wallet } from 'lucide-react'
import { shortAddress } from '@/lib/format'

export function WalletButton({ className = '' }: { className?: string }) {
  return (
    <ConnectKitButton.Custom>
      {({ isConnected, isConnecting, show, address }) => (
        <button type="button" onClick={show} className={`btn ${isConnected ? 'btn-ghost' : 'btn-primary'} ${className}`} aria-label={isConnected ? 'Wallet menu' : 'Connect wallet'}>
          <Wallet className="size-4" aria-hidden />
          {isConnected && address ? <span className="mono text-[13px]">{shortAddress(address, 6, 4)}</span> : isConnecting ? 'Connecting…' : 'Connect wallet'}
        </button>
      )}
    </ConnectKitButton.Custom>
  )
}
