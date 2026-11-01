import type { QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { historyServerUsable } from './mode'
import { chainTrackConfirmed } from './read'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Puts a transaction the app itself just confirmed into History and Activity right away, instead of waiting for the
 * block scan to reach it. Without a history server the receipt is read from Arc and its USDC transfers (and any swap or
 * bridge it contains) are listed from that receipt. With one, the server is asked to index the wallet. Either way the
 * screens are refreshed afterwards. It never throws: if Arc cannot be read the normal scan still picks the transaction up.
 */
export async function recordConfirmedTx({ address, hash, queryClient, bridgeFill = false, attempts = 4 }: { address: string; hash: string; queryClient: QueryClient; bridgeFill?: boolean; attempts?: number }): Promise<boolean> {
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['history'] })
    void queryClient.invalidateQueries({ queryKey: ['activity'] })
  }
  try {
    if (await historyServerUsable()) {
      await api(`/index/${address}`, { method: 'POST' }).catch(() => undefined)
      refresh()
      return true
    }
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        await chainTrackConfirmed(address, hash, { bridgeFill })
        refresh()
        return true
      } catch {
        // A node that has not seen the block yet, or a rate limit: try again shortly.
        await sleep(1_500 * (attempt + 1))
      }
    }
  } catch {
    /* nothing to do: the scan will find it */
  }
  refresh()
  return false
}
