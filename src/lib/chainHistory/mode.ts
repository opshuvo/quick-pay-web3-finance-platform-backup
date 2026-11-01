import { api } from '@/lib/api'

export interface ServerHealth {
  ok: boolean
  database: 'ok' | 'unconfigured' | 'error'
  rpc?: 'ok' | 'error'
}

const TTL_MS = 45_000
let cached: { at: number; usable: Promise<boolean> } | undefined

/**
 * True only when a real FlowPay history server answers with JSON AND its database AND its Arc RPC work.
 * A server whose RPC credentials expired still reports `ok` with a working database, but every history
 * request then fails with a 500, so it must not be chosen over reading Arc directly. On a static
 * host `/api/health` returns the app's HTML (which `api()` reports as an error), so the browser then reads
 * Arc directly instead. The answer is cached briefly so polling screens do not probe on every refresh.
 */
export function historyServerUsable(): Promise<boolean> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.usable
  const usable = api<ServerHealth>('/health')
    .then((h) => Boolean(h && h.ok === true && h.database === 'ok' && h.rpc === 'ok'))
    .catch(() => false)
  cached = { at: Date.now(), usable }
  return usable
}

export const forgetServerProbe = () => { cached = undefined }

/** Resolves when `promise` settles or after `ms`, whichever is first. Never rejects. */
export const waitAtMost = (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, ms))])
