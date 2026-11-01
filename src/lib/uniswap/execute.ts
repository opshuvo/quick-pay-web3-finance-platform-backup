import { erc20Abi, type Address, type PublicClient, type WalletClient } from 'viem'
import { arcMainnet } from '@/lib/arc'
import { confirmTx, TxFlowError } from '@/lib/confirmTx'
import { arcFeeParams } from '@/lib/fees'
import {
  assertSlippage, assertWithinBalance, bestQuote, buildSwap, maxIn, permitNeeded, PERMIT2, PERMIT2_DOMAIN, PERMIT2_TYPES,
  PRICE_IMPACT_BLOCK, type Quote, type Side,
} from './arc'

export type SwapStep = 'quote' | 'approve' | 'approve-confirm' | 'permit' | 'swap' | 'swap-confirm'

export interface SwapResult {
  hash: `0x${string}`
  quote: Quote
  success: boolean
}

/**
 * Wallet flow, in order: slippage cap, balance guard, re-quote, impact gate, exact-amount approval to
 * Permit2 if short, signed Permit2 permit, simulation, gas estimate, send, then wait for the receipt.
 * `success` is true only when the swap transaction is mined with status success.
 */
export async function executeSwap(
  publicClient: PublicClient,
  walletClient: WalletClient,
  tokenIn: Address,
  tokenOut: Address,
  side: Side,
  amount: bigint,
  slippageBps: number,
  confirmedHighImpact: boolean,
  onStep: (step: SwapStep, hash?: `0x${string}`) => void,
): Promise<SwapResult> {
  assertSlippage(slippageBps)
  const [owner] = await walletClient.getAddresses()
  if (side === 'exactIn') await assertWithinBalance(publicClient, tokenIn, owner, amount)
  onStep('quote')
  const quote = await bestQuote(publicClient, tokenIn, tokenOut, side, amount)
  if (quote.priceImpact > PRICE_IMPACT_BLOCK && !confirmedHighImpact) {
    throw new Error(`Price impact ${(quote.priceImpact * 100).toFixed(2)}% is above the ${PRICE_IMPACT_BLOCK * 100}% limit.`)
  }
  const fees = await arcFeeParams(publicClient)

  const spend = side === 'exactIn' ? quote.amountIn : maxIn(quote.amountIn, slippageBps)
  if (side === 'exactOut') await assertWithinBalance(publicClient, tokenIn, owner, spend)

  const tokenAllowance = await publicClient.readContract({ address: tokenIn, abi: erc20Abi, functionName: 'allowance', args: [owner, PERMIT2] })
  if (tokenAllowance < spend) {
    onStep('approve')
    const approveHash = await walletClient.writeContract({
      account: owner, chain: arcMainnet, address: tokenIn, abi: erc20Abi, functionName: 'approve', args: [PERMIT2, spend], ...fees,
    })
    onStep('approve-confirm', approveHash)
    const approveReceipt = await confirmTx(publicClient, approveHash)
    if (approveReceipt.receipt.status !== 'success') throw new TxFlowError('The approval transaction failed. Nothing was swapped.')
  }

  const now = BigInt((await publicClient.getBlock()).timestamp)
  const permit = await permitNeeded(publicClient, owner, tokenIn, spend, now)
  let signature: `0x${string}` | undefined
  if (permit) {
    onStep('permit')
    signature = await walletClient.signTypedData({ account: owner, domain: PERMIT2_DOMAIN, types: PERMIT2_TYPES, primaryType: 'PermitSingle', message: permit })
  }
  const tx = buildSwap(quote, tokenIn, tokenOut, owner, slippageBps, now + 1200n, permit && signature ? { permit, signature } : undefined)

  await publicClient.call({ account: owner, to: tx.to, data: tx.data })
  const gas = await publicClient.estimateGas({ account: owner, to: tx.to, data: tx.data })
  onStep('swap')
  const hash = await walletClient.sendTransaction({
    account: owner, chain: arcMainnet, to: tx.to, data: tx.data, value: 0n, gas: (gas * 12n) / 10n, ...fees,
  })
  onStep('swap-confirm', hash)
  const { hash: mined, receipt } = await confirmTx(publicClient, hash)
  return { hash: mined, quote, success: receipt.status === 'success' }
}
