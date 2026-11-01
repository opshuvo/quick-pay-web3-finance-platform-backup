import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, type Address, type Hash, type Log } from 'viem'
import { quickPayRegistryAbi } from '../src/contracts/quickPayRegistryAbi'
import { confirmCreated, confirmPaid } from '../src/lib/registryEvents'

const REGISTRY = '0x3920870225841408E5bfcADA83d1b50F5fcCa58b' as Address
const OTHER = '0x0000000000000000000000000000000000000dad' as Address
const MERCHANT = '0x0000000000000000000000000000000000000b0b' as Address
const PAYER = '0x00000000000000000000000000000000000a11ce' as Address
const TX = `0x${'ab'.repeat(32)}` as Hash

const base = { blockNumber: 7n, blockHash: TX, logIndex: 0, transactionHash: TX, transactionIndex: 0, removed: false }

function paymentLog(address: Address, id: bigint, merchant: Address, payer: Address, amount: bigint): Log {
  return {
    ...base,
    address,
    topics: encodeEventTopics({ abi: quickPayRegistryAbi, eventName: 'PaymentReceived', args: { id, merchant, payer } }),
    data: encodeAbiParameters([{ type: 'uint128' }, { type: 'uint64' }], [amount, 1_700_000_000n]),
  } as Log
}

function createdLog(address: Address, id: bigint, merchant: Address, payer: Address, amount: bigint): Log {
  return {
    ...base,
    address,
    topics: encodeEventTopics({ abi: quickPayRegistryAbi, eventName: 'RequestCreated', args: { id, merchant, payer } }),
    data: encodeAbiParameters([{ type: 'uint128' }, { type: 'uint64' }, { type: 'bytes32' }], [amount, 0n, `0x${'00'.repeat(32)}`]),
  } as Log
}

const expected = { id: 3n, payer: PAYER, merchant: MERCHANT, amount: 2_500_000n }

describe('registry payments are confirmed only from the registry event', () => {
  test('the matching PaymentReceived event confirms the payment', () => {
    expect(confirmPaid([paymentLog(REGISTRY, 3n, MERCHANT, PAYER, 2_500_000n)], REGISTRY, expected)?.id).toBe(3n)
  })
  test('a wrong id, payer, merchant or amount does not confirm', () => {
    expect(confirmPaid([paymentLog(REGISTRY, 4n, MERCHANT, PAYER, 2_500_000n)], REGISTRY, expected)).toBeUndefined()
    expect(confirmPaid([paymentLog(REGISTRY, 3n, MERCHANT, OTHER, 2_500_000n)], REGISTRY, expected)).toBeUndefined()
    expect(confirmPaid([paymentLog(REGISTRY, 3n, OTHER, PAYER, 2_500_000n)], REGISTRY, expected)).toBeUndefined()
    expect(confirmPaid([paymentLog(REGISTRY, 3n, MERCHANT, PAYER, 2_499_999n)], REGISTRY, expected)).toBeUndefined()
  })
  test('a lookalike event emitted by another contract never confirms', () => {
    expect(confirmPaid([paymentLog(OTHER, 3n, MERCHANT, PAYER, 2_500_000n)], REGISTRY, expected)).toBeUndefined()
  })
  test('an empty receipt does not confirm', () => {
    expect(confirmPaid([], REGISTRY, expected)).toBeUndefined()
  })
})

describe('registry request creation is confirmed only from the registry event', () => {
  test('the matching RequestCreated event confirms and exposes the new id', () => {
    expect(confirmCreated([createdLog(REGISTRY, 9n, MERCHANT, PAYER, 1_000_000n)], REGISTRY, MERCHANT, 1_000_000n)?.id).toBe(9n)
  })
  test('another merchant, another amount or another contract does not confirm', () => {
    expect(confirmCreated([createdLog(REGISTRY, 9n, OTHER, PAYER, 1_000_000n)], REGISTRY, MERCHANT, 1_000_000n)).toBeUndefined()
    expect(confirmCreated([createdLog(REGISTRY, 9n, MERCHANT, PAYER, 1_000_001n)], REGISTRY, MERCHANT, 1_000_000n)).toBeUndefined()
    expect(confirmCreated([createdLog(OTHER, 9n, MERCHANT, PAYER, 1_000_000n)], REGISTRY, MERCHANT, 1_000_000n)).toBeUndefined()
  })
})
