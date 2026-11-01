import { erc20Abi, type Address, type PublicClient, type WalletClient } from 'viem'
import { arcMainnet } from '@/lib/arc'
import { confirmTx, TxFlowError } from '@/lib/confirmTx'
import { arcFeeParams } from '@/lib/fees'
import { PERMIT2 } from './arc'
import { uniswapApi, type ApiQuoteResponse } from './api'
import { assertQuoteMatches, permitTypes, quoteExpired, validatePermit, validateSwapTx } from './apiValidate'
import type { SwapStep } from './execute'

export type ApiSwapStep = SwapStep | 'build'

export interface ApiSwapContext {
  tokenIn: Address
  tokenOut: Address
  amount: bigint
  quoteFetchedAt: number
}

/**
 * Executes a swap the Uniswap Trading API quoted. In order: freshness and consistency checks, balance
 * guard, exact-amount approval to Permit2 (built here, never taken from the API), signed Permit2 permit,
 * API-built transaction, validation, simulation, gas estimate, send, wait for the receipt.
 * `success` is true only when the swap is mined with status success.
 */
export async function executeApiSwap(
  publicClient: PublicClient,
  walletClient: WalletClient,
  response: ApiQuoteResponse,
  ctx: ApiSwapContext,
  onStep: (step: ApiSwapStep, hash?: `0x${string}`) => void,
): Promise<{ hash: `0x${string}`; success: boolean }> {
  const [owner] = await walletClient.getAddresses()
  if (quoteExpired(ctx.quoteFetchedAt)) throw new Error('This quote expired. Refresh it and review again.')
  assertQuoteMatches(response.quote, { tokenIn: ctx.tokenIn, tokenOut: ctx.tokenOut, amount: ctx.amount, wallet: owner })

  const balance = await publicClient.readContract({ address: ctx.tokenIn, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
  if (balance < ctx.amount) throw new Error('Amount exceeds your token balance.')
  const fees = await arcFeeParams(publicClient)

  // Uniswap is asked, the chain decides: approve if either says the allowance is short.
  const [allowance, apiSays] = await Promise.all([
    publicClient.readContract({ address: ctx.tokenIn, abi: erc20Abi, functionName: 'allowance', args: [owner, PERMIT2] }),
    uniswapApi.checkApproval({ walletAddress: owner, token: ctx.tokenIn, amount: ctx.amount.toString() }).then((r) => r.approvalRequired).catch(() => false),
  ])
  if (allowance < ctx.amount || apiSays) {
    onStep('approve')
    const approveHash = await walletClient.writeContract({
      account: owner, chain: arcMainnet, address: ctx.tokenIn, abi: erc20Abi, functionName: 'approve', args: [PERMIT2, ctx.amount], ...fees,
    })
    onStep('approve-confirm', approveHash)
    const approval = await confirmTx(publicClient, approveHash)
    if (approval.receipt.status !== 'success') throw new TxFlowError('The approval transaction failed. Nothing was swapped.')
  }

  let signature: `0x${string}` | undefined
  if (response.permitData) {
    const permit = validatePermit(response.permitData, { tokenIn: ctx.tokenIn, amount: ctx.amount })
    onStep('permit')
    signature = await walletClient.signTypedData({
      account: owner,
      domain: { name: response.permitData.domain.name, chainId: Number(response.permitData.domain.chainId), verifyingContract: response.permitData.domain.verifyingContract as Address },
      types: permitTypes(response.permitData),
      primaryType: 'PermitSingle',
      message: permit,
    })
  }

  onStep('build')
  const built = await uniswapApi.swap({
    quote: response.quote,
    ...(response.permitData && signature ? { permitData: response.permitData, signature } : {}),
    swapper: owner,
  })
  const tx = validateSwapTx(built, owner)

  await publicClient.call({ account: owner, to: tx.to, data: tx.data })
  const gas = await publicClient.estimateGas({ account: owner, to: tx.to, data: tx.data })
  onStep('swap')
  const hash = await walletClient.sendTransaction({
    account: owner, chain: arcMainnet, to: tx.to, data: tx.data, value: 0n, gas: (gas * 12n) / 10n, ...fees,
  })
  onStep('swap-confirm', hash)
  const { hash: mined, receipt } = await confirmTx(publicClient, hash)
  return { hash: mined, success: receipt.status === 'success' }
}
