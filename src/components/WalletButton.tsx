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
    <button type="button" onClick={() => walletModal.request()} className={`btn ${isConnected ? 'btn-ghost' : 'btn-primary'} min-w-0 shrink-0 !px-3 sm:!px-4 ${className}`} aria-label={isConnected ? 'Wallet menu' : 'Connect wallet'}>
      <Wallet className="size-4 shrink-0" aria-hidden />
      {isConnected && address ? (
        <>
          <span className="mono text-[13px] sm:hidden">{shortAddress(address, 4, 4)}</span>
          <span className="mono hidden text-[13px] sm:inline">{shortAddress(address, 6, 4)}</span>
        </>
      ) : modalOpen ? 'Connecting…' : (
        <>
          <span className="sm:hidden">Connect</span>
          <span className="hidden sm:inline">Connect wallet</span>
        </>
      )}
    </button>
  )
}
