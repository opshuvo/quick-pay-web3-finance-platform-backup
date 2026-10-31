import { useConfig } from 'wagmi'
import { useArcWallet } from '@/hooks/useArcWallet'
import { Notice, Spinner } from '@/components/ui'

/** Shown on every screen when the connected wallet is not on Arc Mainnet. */
export function NetworkBanner() {
  const { wrongNetwork, chainId, switchToArc, switching } = useArcWallet()
  const config = useConfig()
  if (!wrongNetwork) return null
  const name = config.chains.find((c) => c.id === chainId)?.name ?? `chain ${chainId}`
  return (
    <div className="mb-4">
      <Notice
        tone="warn"
        action={
          <button className="btn btn-primary" onClick={() => void switchToArc()} disabled={switching}>
            {switching && <Spinner />} Switch to Arc
          </button>
        }
      >
        Your wallet is on {name}. Quick Pay payments run on Arc Mainnet (chain ID 5042). Switch networks before sending, swapping, or paying a request.
      </Notice>
    </div>
  )
}
