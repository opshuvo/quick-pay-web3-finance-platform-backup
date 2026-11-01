import type { SessionToken } from '../../shared/session'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

interface Options {
  method?: 'GET' | 'POST'
  body?: unknown
  token?: SessionToken
  signal?: AbortSignal
}

const encodeToken = (token: SessionToken) => btoa(JSON.stringify(token))

/** Longest any backend call may take before it is reported as a timeout (never an endless spinner). */
export const API_TIMEOUT_MS = 20_000

/**
 * All backend calls go through `/api` (the Vite proxy in development, a rewrite in production).
 * A success response that is not JSON means no backend answered (on a static host `/api/*` falls through
 * to the app's own index.html), and is reported as such instead of being returned as empty data.
 */
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers.authorization = `QuickPay ${encodeToken(options.token)}`
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, API_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort)
  let response: Response
  let text: string
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
    text = await response.text()
  } catch (error) {
    if (timedOut) throw new ApiError(0, 'timeout', 'The Quick Pay service took too long to respond.')
    if (options.signal?.aborted) throw error
    throw new ApiError(0, 'unreachable', 'The Quick Pay service is unreachable right now.')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
  let data: unknown = null
  let isJson = text === ''
  if (text !== '') {
    try {
      data = JSON.parse(text)
      isJson = true
    } catch {
      isJson = false
    }
  }
  if (response.ok && !isJson) throw new ApiError(503, 'backend_unavailable', 'The Quick Pay backend is not connected to this deployment.')
  if (!response.ok) {
    const body = data as { error?: string; message?: string } | null
    throw new ApiError(response.status, body?.error ?? 'error', body?.message ?? `Request failed (${response.status})`)
  }
  return data as T
}

export const isServiceDown = (error: unknown) =>
  error instanceof ApiError && (['unreachable', 'timeout', 'backend_unavailable', 'database_not_configured'].includes(error.code) || error.status >= 500)

/** True when no Quick Pay backend answered at all (as opposed to it answering with an error). */
export const isBackendMissing = (error: unknown) => error instanceof ApiError && error.code === 'backend_unavailable'

/** The browser could not read Arc through its RPC (rate limit, no answer). Temporary, and retried automatically. */
export const isRpcUnavailable = (error: unknown) => error instanceof ApiError && error.code === 'rpc_unavailable'
