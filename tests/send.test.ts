import { describe, expect, test } from 'bun:test'
import { runUsdcSend, SingleFlight, type SendState } from '../src/lib/sendFlow'

const HASH = `0x${'ab'.repeat(32)}` as const
const collect = () => {
  const states: SendState[] = []
  return { states, onState: (s: SendState) => states.push(s), last: () => states[states.length - 1] }
}

describe('runUsdcSend', () => {
  test('success is reported only after a successful receipt', async () => {
    const c = collect()
    const result = await runUsdcSend({ submit: async () => HASH, waitForReceipt: async () => ({ status: 'success' }), onState: c.onState })
    expect(result).toBe(HASH)
    expect(c.states.map((s) => s.stage)).toEqual(['wallet', 'confirming', 'success'])
  })
  test('a rejected wallet prompt is a cancellation, never a failure of funds, and shows no hash', async () => {
    const c = collect()
    const result = await runUsdcSend({ submit: async () => { throw Object.assign(new Error('User rejected the request.'), { code: 4001 }) }, waitForReceipt: async () => ({ status: 'success' }), onState: c.onState })
    expect(result).toBeNull()
    expect(c.last()).toMatchObject({ stage: 'error', cancelled: true })
    expect(c.last()?.hash).toBeUndefined()
  })
  test('a reverted receipt is an error with the hash and never success', async () => {
    const c = collect()
    const result = await runUsdcSend({ submit: async () => HASH, waitForReceipt: async () => ({ status: 'reverted' }), onState: c.onState })
    expect(result).toBeNull()
    expect(c.last()).toMatchObject({ stage: 'error', hash: HASH })
    expect(c.states.some((s) => s.stage === 'success')).toBe(false)
  })
  test('broadcast but unconfirmable keeps the hash and warns that it may still complete', async () => {
    const c = collect()
    const result = await runUsdcSend({ submit: async () => HASH, waitForReceipt: async () => { throw new Error('timed out waiting for receipt') }, onState: c.onState })
    expect(result).toBeNull()
    expect(c.last()?.hash).toBe(HASH)
    expect(c.last()?.error).toMatch(/may still complete/)
    expect(c.states.some((s) => s.stage === 'success')).toBe(false)
  })
  test('failing to estimate fees or reach the wallet before submission is an error without a hash', async () => {
    const c = collect()
    await runUsdcSend({ submit: async () => { throw new Error('fee estimation failed') }, waitForReceipt: async () => ({ status: 'success' }), onState: c.onState })
    expect(c.last()?.stage).toBe('error')
    expect(c.last()?.hash).toBeUndefined()
  })
})

describe('SingleFlight (duplicate submission)', () => {
  test('a second submission while one is in flight is ignored', async () => {
    const flight = new SingleFlight()
    let submits = 0
    let release: () => void = () => undefined
    const slow = () => new Promise<string>((resolve) => { submits += 1; release = () => resolve('done') })
    const first = flight.run(slow)
    const second = await flight.run(slow)
    const third = await flight.run(slow)
    expect(second).toBeUndefined()
    expect(third).toBeUndefined()
    expect(flight.isBusy).toBe(true)
    release()
    expect(await first).toBe('done')
    expect(submits).toBe(1)
    expect(flight.isBusy).toBe(false)
  })
  test('it releases after a failure so the user can retry', async () => {
    const flight = new SingleFlight()
    await expect(flight.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await flight.run(async () => 'again')).toBe('again')
  })
})
