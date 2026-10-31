import { isAddress } from 'viem'
import { HttpError } from './db'

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...headers,
    },
  })

export const errorResponse = (error: unknown) => {
  if (error instanceof HttpError) return json({ error: error.code, message: error.message }, error.status)
  console.error('[server] unexpected error', (error as Error)?.message)
  return json({ error: 'internal', message: 'Unexpected server error.' }, 500)
}

export async function readJson<T>(req: Request, maxBytes = 16_384): Promise<T> {
  // Refuse oversized bodies from the declared length before reading anything into memory.
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, 'too_large', 'Request body is too large.')
  const text = await req.text()
  if (text.length > maxBytes) throw new HttpError(413, 'too_large', 'Request body is too large.')
  try {
    return JSON.parse(text) as T
  } catch {
    throw new HttpError(400, 'bad_json', 'Request body must be valid JSON.')
  }
}

export function parseAddress(value: string | undefined, label = 'address'): string {
  if (!value || !isAddress(value, { strict: false })) throw new HttpError(400, 'bad_address', `Invalid ${label}.`)
  return value.toLowerCase()
}

const buckets = new Map<string, { count: number; reset: number }>()

/** Fixed-window rate limit per client key. In-memory: use an edge limiter for multi-instance deploys. */
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs })
    if (buckets.size > 20_000) for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k)
    return
  }
  bucket.count += 1
  if (bucket.count > limit) throw new HttpError(429, 'rate_limited', 'Too many requests. Please slow down.')
}
