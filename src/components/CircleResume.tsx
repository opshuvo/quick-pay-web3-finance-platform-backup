import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { EIP1193Provider } from 'viem'
import { Spinner } from '@/components/ui'
import { buildCircleAdapter, loadCircleChains, parseResult, resumeCircleTransfer, serializeResult, summarizeCircleResult } from '@/lib/circle'
import { saveBridge, type StoredBridge } from '@/lib/bridgeStore'
import { parseTxError } from '@/lib/errors'

/**
 * Resumes a Circle transfer that stopped after the burn (for example a rejected or failed mint signature). It continues
 * from the failed step with the SDK's own recovery, so the burn is never repeated. The outcome is still read back
 * from the chains by the tracker; this button only submits the missing transactions.
 */
export function CircleResume({ item }: { item: StoredBridge }) {
  const { address, connector } = useAccount()
  const queryClient = useQueryClient()
  const chains = useQuery({ queryKey: ['circle-chains'], queryFn: loadCircleChains, staleTime: Infinity, retry: 1 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saved = item.circle?.resumable
  const wrongWallet = Boolean(address && item.wallet && address.toLowerCase() !== item.wallet.toLowerCase())

  if (!saved) {
    return <p className="mt-2 text-xs" style={{ color: 'var(--warn)' }}>This device has no saved state to resume this transfer. Your burned USDC is not lost: Circle can still be asked to complete the mint with the burn transaction above.</p>
  }

  async function resume() {
    if (!connector || !item.circle || !chains.data || !item.wallet) return
    setBusy(true)
    setError(null)
    try {
      const adapter = await buildCircleAdapter((await connector.getProvider()) as EIP1193Provider, chains.data)
      const result = await resumeCircleTransfer(parseResult(saved as string), adapter)
      const s = summarizeCircleResult(result)
      saveBridge(item.wallet, { ...item, circle: { ...item.circle, mintTx: s.mint ?? item.circle.mintTx, resumable: result.state === 'success' ? undefined : serializeResult(result) } })
      if (result.state !== 'success') setError(`Still stopped at "${s.failedStep ?? 'a step'}"${s.failedMessage ? `: ${s.failedMessage}` : ''}.`)
      void queryClient.invalidateQueries({ queryKey: ['bridge-track', item.hash] })
    } catch (e) {
      setError(parseTxError(e).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3">
      <button className="btn btn-primary w-full sm:w-auto" disabled={busy || !connector || wrongWallet || !chains.data} onClick={() => void resume()}>{busy && <Spinner />} Resume transfer</button>
      {wrongWallet && <p className="mt-2 text-xs" style={{ color: 'var(--warn)' }}>Connect the wallet that started this transfer to resume it.</p>}
      {error && <p role="alert" className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}
