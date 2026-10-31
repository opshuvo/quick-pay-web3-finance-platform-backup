import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { api, ApiError, isBackendMissing, isServiceDown } from '../src/lib/api'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })
const respond = (body: string, status = 200) => { globalThis.fetch = (async () => new Response(body, { status })) as unknown as typeof fetch }

describe('api()', () => {
  test('an HTML page returned with 200 (no backend on a static host) is an error, never empty data', async () => {
    respond('<!DOCTYPE html><html><body>app</body></html>')
    const error = await api('/uniswap/status').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('backend_unavailable')
    expect(isBackendMissing(error)).toBe(true)
    expect(isServiceDown(error)).toBe(true)
  })
  test('JSON bodies and empty bodies still succeed', async () => {
    respond('{"ok":true}')
    expect(await api('/health')).toEqual({ ok: true })
    respond('')
    expect(await api('/index/0x1', { method: 'POST' })).toBeNull()
  })
  test('server errors keep their own code and message', async () => {
    respond('{"error":"rate_limited","message":"Slow down."}', 429)
    const error = (await api('/x').catch((e: unknown) => e)) as ApiError
    expect(error).toMatchObject({ status: 429, code: 'rate_limited', message: 'Slow down.' })
    expect(isBackendMissing(error)).toBe(false)
  })
  test('a network failure is reported as unreachable', async () => {
    globalThis.fetch = (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    expect(((await api('/x').catch((e: unknown) => e)) as ApiError).code).toBe('unreachable')
  })
  test('a call that never answers ends in a timeout error', async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))) })) as unknown as typeof fetch
    const timers = globalThis.setTimeout
    globalThis.setTimeout = ((fn: () => void) => timers(fn, 5)) as unknown as typeof setTimeout
    try {
      expect(((await api('/slow').catch((e: unknown) => e)) as ApiError).code).toBe('timeout')
    } finally {
      globalThis.setTimeout = timers
    }
  })
})

describe('Vercel rewrites (public/vercel.json)', () => {
  const config = JSON.parse(readFileSync(new URL('../public/vercel.json', import.meta.url), 'utf8')) as { rewrites: { source: string; destination: string }[] }
  const across = readFileSync(new URL('../src/lib/across.ts', import.meta.url), 'utf8')
  test('every Across path the client calls is proxied to the real Across API', () => {
    const paths = [...across.matchAll(/['`]\/across(\/[a-z/-]+)/g)].map((m) => m[1])
    expect(paths.length).toBeGreaterThanOrEqual(4)
    for (const path of paths) {
      const rule = config.rewrites.find((r) => r.source === `/api/across${path}`)
      expect(rule?.destination).toBe(`https://app.across.to/api${path}`)
    }
  })
  test('only allow-listed Across paths are proxied, and the SPA catch-all is last', () => {
    const external = config.rewrites.filter((r) => r.destination.startsWith('https://'))
    for (const r of external) expect(r.destination.startsWith('https://app.across.to/api/')).toBe(true)
    expect(config.rewrites[config.rewrites.length - 1]).toEqual({ source: '/(.*)', destination: '/index.html' })
  })
})
