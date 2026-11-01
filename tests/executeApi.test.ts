import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { UNISWAP_PERMIT2, UNISWAP_UNIVERSAL_ROUTER } from '../shared/uniswap-constants'

// Control-flow tests with scripted wallet/RPC objects: they prove what the executor does on
// rejection, failed approvals, failed swaps, stale quotes and hostile API output.
const USDC = '0x3600000000000000000000000000000000000000'
const OTHER = '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1'
const ME = '0x52908400098527886E0F7030069857D2E4169EE7'

let swapTarget = UNISWAP_UNIVERSAL_ROUTER
let approvalRequired = false
mock.module('../src/lib/uniswap/api', () => ({
  uniswapApi: {
    checkApproval: async () => ({ approvalRequired, spender: UNISWAP_PERMIT2, requestId: null }),
    swap: async () => ({ swap: { to: swapTarget, data: '0x3593564c00000000', value: '0', chainId: 5042, gasLimit: null }, gasFee: null, requestId: null }),
  },
}))
const { executeApiSwap } = await import('../src/lib/uniswap/executeApi')

const quote = () => ({
  routing: 'CLASSIC' as const,
  requestId: null,
  permitData: {
    domain: { name: 'Permit2', chainId: 5042, verifyingContract: UNISWAP_PERMIT2 },
    types: { EIP712Domain: [], PermitSingle: [], PermitDetails: [] },
    values: { details: { token: USDC, amount: '1000000', expiration: String(2_000_000_000), nonce: '0' }, spender: UNISWAP_UNIVERSAL_ROUTER, sigDeadline: String(2_000_000_000) },
  },
  quote: { input: { token: USDC, amount: '1000000' }, output: { token: OTHER, amount: '990000', recipient: ME }, chainId: 5042 },
})

interface Script {
  allowance?: bigint
  approveReceipt?: 'success' | 'reverted'
  swapReceipt?: 'success' | 'reverted'
  rejectApprove?: boolean
  rejectSign?: boolean
  rejectSend?: boolean
}
const calls: string[] = []
function clients(s: Script = {}) {
  const publicClient = {
    readContract: async ({ functionName }: { functionName: string }) => (functionName === 'balanceOf' ? 5_000_000n : (s.allowance ?? 0n)),
    estimateFeesPerGas: async () => ({ maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1n }),
    waitForTransactionReceipt: async ({ hash }: { hash: string }) => ({ transactionHash: hash, status: hash === '0xapprove' ? (s.approveReceipt ?? 'success') : (s.swapReceipt ?? 'success') }),
    call: async () => ({}),
    estimateGas: async () => 200_000n,
  }
  const walletClient = {
    getAddresses: async () => [ME],
    writeContract: async () => {
      calls.push('approve')
      if (s.rejectApprove) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
      return '0xapprove'
    },
    signTypedData: async () => {
      calls.push('sign')
      if (s.rejectSign) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
      return `0x${'11'.repeat(65)}`
    },
    sendTransaction: async () => {
      calls.push('send')
      if (s.rejectSend) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
      return '0xswap'
    },
  }
  return { publicClient: publicClient as never, walletClient: walletClient as never }
}
const ctx = (over: Partial<{ quoteFetchedAt: number }> = {}) => ({ tokenIn: USDC as `0x${string}`, tokenOut: OTHER as `0x${string}`, amount: 1_000_000n, quoteFetchedAt: Date.now(), ...over })

beforeEach(() => {
  calls.length = 0
  swapTarget = UNISWAP_UNIVERSAL_ROUTER
  approvalRequired = false
})

describe('executeApiSwap', () => {
  test('happy path: exact approval, permit, API tx, then success only from the receipt', async () => {
    const steps: string[] = []
    const { publicClient, walletClient } = clients({ allowance: 0n })
    const result = await executeApiSwap(publicClient, walletClient, quote() as never, ctx(), (s) => steps.push(s))
    expect(result).toEqual({ hash: '0xswap', success: true })
    expect(steps).toEqual(['approve', 'approve-confirm', 'permit', 'build', 'swap', 'swap-confirm'])
    expect(calls).toEqual(['approve', 'sign', 'send'])
  })
  test('skips the approval when the allowance already covers the amount', async () => {
    const { publicClient, walletClient } = clients({ allowance: 1_000_000n })
    await executeApiSwap(publicClient, walletClient, quote() as never, ctx(), () => undefined)
    expect(calls).toEqual(['sign', 'send'])
  })
  test('wallet rejection on approval stops everything and sends nothing', async () => {
    const { publicClient, walletClient } = clients({ rejectApprove: true })
    await expect(executeApiSwap(publicClient, walletClient, quote() as never, ctx(), () => undefined)).rejects.toMatchObject({ code: 4001 })
    expect(calls).toEqual(['approve'])
  })
  test('wallet rejection when signing the permit sends no swap', async () => {
    const { publicClient, walletClient } = clients({ allowance: 1_000_000n, rejectSign: true })
    await expect(executeApiSwap(publicClient, walletClient, quote() as never, ctx(), () => undefined)).rejects.toMatchObject({ code: 4001 })
    expect(calls).toEqual(['sign'])
  })
  test('wallet rejection on the final swap leaves nothing submitted', async () => {
    const { publicClient, walletClient } = clients({ allowance: 1_000_000n, rejectSend: true })
    await expect(executeApiSwap(publicClient, walletClient, quote() as never, ctx(), () => undefined)).rejects.toMatchObject({ code: 4001 })
    expect(calls).toEqual(['sign', 'send'])
  })
  test('a reverted approval throws and never reaches the swap', async () => {
    const { publicClient, walletClient } = clients({ approveReceipt: 'reverted' })
    await expect(executeApiSwap(publicClient, walletClient, quote() as never, ctx(), () => undefined)).rejects.toThrow(/approval transaction failed/)
    expect(calls).toEqual(['approve'])
  })
  test('a reverted swap is reported as failure, never success', async () => {
    const { publicClient, walletClient } = clients({ allowance: 1_000_000n, swapReceipt: 'reverted' })
    const result = await executeApiSwap(publicClient, walletClient, quote() as never, ctx(), () => undefined)
    expect(result.success).toBe(false)
  })
  test('a stale quote is refused before any wallet interaction', async () => {
    const { publicClient, walletClient } = clients()
    await expect(executeApiSwap(publicClient, walletClient, quote() as never, ctx({ quoteFetchedAt: Date.now() - 31_000 }), () => undefined)).rejects.toThrow(/expired/)
    expect(calls).toEqual([])
  })
  test('a transaction aimed at any other contract is blocked before it is sent', async () => {
    swapTarget = '0x000000000000000000000000000000000000dead'
    const { publicClient, walletClient } = clients({ allowance: 1_000_000n })
    await expect(executeApiSwap(publicClient, walletClient, quote() as never, ctx(), () => undefined)).rejects.toThrow(/unexpected contract/)
    expect(calls).toEqual(['sign'])
  })
  test('a quote for a different amount than requested is refused', async () => {
    const { publicClient, walletClient } = clients()
    const q = quote()
    q.quote.input.amount = '2000000'
    await expect(executeApiSwap(publicClient, walletClient, q as never, ctx(), () => undefined)).rejects.toThrow(/different amount/)
    expect(calls).toEqual([])
  })
})
