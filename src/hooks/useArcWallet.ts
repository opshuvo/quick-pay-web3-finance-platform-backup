import { useCallback } from 'react'
import { erc20Abi } from 'viem'
import { useAccount, useReadContract, useSwitchChain } from 'wagmi'
import { toast } from 'sonner'
import { ARC_CHAIN_ID, ARC_USDC } from '@/lib/arc'
import { parseTxError } from '@/lib/errors'

/** Single source of truth for wallet + network state on Arc Mainnet. */
export function useArcWallet() {
  const { address, isConnected, isConnecting, isReconnecting, chainId, connector } = useAccount()
  const { switchChainAsync, isPending: switching } = useSwitchChain()
  const onArc = chainId === ARC_CHAIN_ID
  const wrongNetwork = isConnected && !onArc

  // USDC ERC-20 view (6 decimals). On Arc this is the same pool as the native gas balance,
  // so it is the only balance shown anywhere in the app.
  const balance = useReadContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  })

  const switchToArc = useCallback(async () => {
    try {
      await switchChainAsync({ chainId: ARC_CHAIN_ID })
      return true
    } catch (error) {
      const parsed = parseTxError(error)
      if (parsed.kind !== 'rejected') toast.error('Could not switch network. Switch to Arc in your wallet and retry.')
      return false
    }
  }, [switchChainAsync])

  return {
    address,
    isConnected,
    isConnecting: isConnecting || isReconnecting,
    chainId,
    connectorName: connector?.name,
    onArc,
    wrongNetwork,
    switching,
    switchToArc,
    balanceRaw: balance.data,
    balanceLoading: balance.isLoading,
    balanceError: balance.isError,
    refetchBalance: balance.refetch,
  }
}
