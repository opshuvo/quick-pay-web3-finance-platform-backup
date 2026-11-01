/** Bridge transfers started from this browser. Kept on this device only, used just to resume status tracking. */
export interface StoredBridge {
  hash: `0x${string}`
  originChainId: number
  destinationChainId: number
  amount: string
  symbol: string
  createdAt: number
  /** Quote metadata kept so the history record can be written once Across has indexed the deposit. */
  wallet?: string
  inputToken?: string
  outputToken?: string
  recipient?: string
  expectedOutput?: string
  feeAmount?: string
  inputSymbol?: string
  inputDecimals?: number
  outputSymbol?: string
  outputDecimals?: number
}

const KEY = 'quickpay.bridges.v1'

export function loadBridges(address: string): StoredBridge[] {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, StoredBridge[]>
    return all[address.toLowerCase()] ?? []
  } catch {
    return []
  }
}

export function saveBridge(address: string, entry: StoredBridge): void {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, StoredBridge[]>
    const list = [entry, ...(all[address.toLowerCase()] ?? []).filter((b) => b.hash !== entry.hash)].slice(0, 20)
    localStorage.setItem(KEY, JSON.stringify({ ...all, [address.toLowerCase()]: list }))
  } catch {
    /* storage unavailable: tracking simply will not persist */
  }
}

/** Forgets a transfer whose source transaction did not succeed, so it is never tracked as if it were in flight. */
export function removeBridge(address: string, hash: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, StoredBridge[]>
    const key = address.toLowerCase()
    localStorage.setItem(KEY, JSON.stringify({ ...all, [key]: (all[key] ?? []).filter((b) => b.hash.toLowerCase() !== hash.toLowerCase()) }))
  } catch {
    /* storage unavailable: nothing to remove */
  }
}
