import { useCallback, useMemo, useState } from 'react'
import { erc20Abi, isAddress, zeroAddress, type Address } from 'viem'
import { useAccount, useReadContracts } from 'wagmi'
import { PRESET_TOKENS } from '@/components/TokenSelect'
import { ARC_CHAIN_ID } from '@/lib/arc'

export interface ListedToken {
  address: Address
  symbol: string
  name: string
  decimals: number
  /** Undefined when no wallet is connected or the balance read failed. Never a guess. */
  balance?: bigint
  preset: boolean
}

const KEY = 'quickpay.swap.customTokens.v1'

function loadCustom(): Address[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((a): a is Address => typeof a === 'string' && isAddress(a)) : []
  } catch {
    return []
  }
}

/**
 * Tokens shown in Swap: the presets plus any token the user added by address. Every entry is read from
 * its own contract on Arc (symbol, name, decimals, balance); a token that fails those reads is dropped.
 */
export function useTokenList() {
  const { address: owner } = useAccount()
  const [custom, setCustom] = useState<Address[]>(loadCustom)
  const addresses = useMemo(() => {
    const seen = new Set<string>()
    return [...PRESET_TOKENS.map((t) => t.address), ...custom].filter((a) => a.toLowerCase() !== zeroAddress && !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()))
  }, [custom])

  const contracts = useMemo(
    () =>
      addresses.flatMap((address) => [
        { address, abi: erc20Abi, functionName: 'symbol' as const, chainId: ARC_CHAIN_ID },
        { address, abi: erc20Abi, functionName: 'name' as const, chainId: ARC_CHAIN_ID },
        { address, abi: erc20Abi, functionName: 'decimals' as const, chainId: ARC_CHAIN_ID },
        ...(owner ? [{ address, abi: erc20Abi, functionName: 'balanceOf' as const, args: [owner] as const, chainId: ARC_CHAIN_ID }] : []),
      ]),
    [addresses, owner],
  )
  const read = useReadContracts({ allowFailure: true, contracts, query: { refetchInterval: 20_000 } })
  const stride = owner ? 4 : 3

  const tokens = useMemo<ListedToken[]>(() => {
    const data = read.data
    if (!data) return []
    return addresses.flatMap((address, i): ListedToken[] => {
      const [symbol, name, decimals, balance] = data.slice(i * stride, i * stride + stride)
      if (symbol?.status !== 'success' || decimals?.status !== 'success') return []
      return [{
        address,
        symbol: String(symbol.result),
        name: name?.status === 'success' ? String(name.result) : String(symbol.result),
        decimals: Number(decimals.result),
        balance: balance?.status === 'success' ? (balance.result as bigint) : undefined,
        preset: PRESET_TOKENS.some((p) => p.address.toLowerCase() === address.toLowerCase()),
      }]
    })
  }, [read.data, addresses, stride])

  const add = useCallback((address: Address) => {
    setCustom((current) => {
      if (current.some((a) => a.toLowerCase() === address.toLowerCase())) return current
      const next = [...current, address]
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* storage unavailable: the token still works for this session */
      }
      return next
    })
  }, [])

  const remove = useCallback((address: Address) => {
    setCustom((current) => {
      const next = current.filter((a) => a.toLowerCase() !== address.toLowerCase())
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const failedPresets = PRESET_TOKENS.filter((t) => !tokens.some((x) => x.address.toLowerCase() === t.address.toLowerCase())).length
  const balanceFailed = Boolean(owner) && tokens.length > 0 && tokens.some((t) => t.balance === undefined)
  return { tokens, isLoading: read.isLoading, add, remove, refetch: read.refetch, isFetching: read.isFetching, readFailed: read.isError || (!read.isLoading && failedPresets > 0), balanceFailed }
}
