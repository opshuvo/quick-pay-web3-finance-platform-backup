import { erc20Abi, isAddress, zeroAddress, type Address } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { ARC_CHAIN_ID } from '@/lib/arc'

export interface TokenInfo {
  address: Address
  symbol: string
  decimals: number
}

/** Reads symbol and decimals straight from the token contract on Arc. Rejects the zero/native sentinel. */
export function useToken(address: string | undefined) {
  const valid = Boolean(address && isAddress(address) && address.toLowerCase() !== zeroAddress)
  const { address: owner } = useAccount()
  const target = valid ? (address as Address) : undefined
  const base = { address: target, abi: erc20Abi, chainId: ARC_CHAIN_ID } as const
  const symbol = useReadContract({ ...base, functionName: 'symbol', query: { enabled: valid, retry: 1 } })
  const decimals = useReadContract({ ...base, functionName: 'decimals', query: { enabled: valid, retry: 1 } })
  const balance = useReadContract({ ...base, functionName: 'balanceOf', args: owner ? [owner] : undefined, query: { enabled: valid && Boolean(owner), refetchInterval: 20_000 } })
  const info: TokenInfo | undefined =
    target && symbol.data !== undefined && decimals.data !== undefined ? { address: target, symbol: symbol.data, decimals: decimals.data } : undefined
  const settled = !symbol.isLoading && !decimals.isLoading
  return {
    info,
    balance: balance.data,
    isLoading: valid && (symbol.isLoading || decimals.isLoading),
    invalid: Boolean(address) && (!valid || (settled && !info)),
  }
}
