import { useSyncExternalStore } from 'react'
import { Wallet } from 'lucide-react'
import { useAccount } from 'wagmi'
import { shortAddress } from '@/lib/format'
import { walletModal } from '@/lib/walletModal'

/** Wallet connect / account button. The wallet picker itself loads on demand; this button responds at once. */
export function WalletButton({ className = '' }: { className?: string }) {
  const { address, isConnected } = useAccount()
  const modalOpen = useSyncExternalStore((cb) => walletModal.subscribe(cb), () => walletModal.isOpen(), () => false)
  return (
    <button type="button" onClick={() => walletModal.request()} className={`btn ${isConnected ? 'btn-ghost' : 'btn-primary'} ${className}`} aria-label={isConnected ? 'Wallet menu' : 'Connect wallet'}>
      <Wallet className="size-4" aria-hidden />
      {isConnected && address ? <span className="mono text-[13px]">{shortAddress(address, 6, 4)}</span> : modalOpen ? 'Connecting…' : 'Connect wallet'}
    </button>
  )
}
