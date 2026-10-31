/**
 * Quick Pay backend: wallet history indexer, payment requests, Across proxy.
 * Run with `bun run server`. The Vite dev server proxies `/api/*` here (prefix stripped).
 */
import { listActivity, recordBridge, recordSwap, refreshBridge } from './activity'
import { proxyAcross } from './across'
import { requireWallet } from './auth'
import { HttpError, migrate, requireDb, sql } from './db'
import { config } from './env'
import { exportCsv, queryAnalytics, queryHistory, type HistoryFilters } from './history'
import { errorResponse, json, parseAddress, rateLimit, readJson } from './http'
import { coverage, getHead, registerWallet, startIndexer, syncTip, touchWallet } from './indexer'
import { checkApproval, createSwap, getQuote, uniswapStatus } from './uniswap'
import { cancelRequest, createRequest, getRequest, listRequests, verifyPayment } from './requests'

await migrate()
startIndexer()

const intParam = (value: string | null, fallback: number, min: number, max: number) => {
  const n = Number(value)
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback
}

function filtersFrom(address: string, params: URLSearchParams): HistoryFilters {
  const direction = params.get('direction')
  const type = params.get('type')
  const since = params.get('since') ? new Date(params.get('since') as string) : undefined
  const until = params.get('until') ? new Date(params.get('until') as string) : undefined
  if ((since && Number.isNaN(since.getTime())) || (until && Number.isNaN(until.getTime()))) throw new HttpError(400, 'bad_date', 'Invalid date filter.')
  return {
    address,
    direction: direction === 'in' || direction === 'out' ? direction : 'all',
    type: type === 'transfer' || type === 'request_payment' || type === 'swap' || type === 'bridge' ? type : 'all',
    q: (params.get('q') ?? '').slice(0, 70),
    since,
    until,
    page: intParam(params.get('page'), 1, 1, 100_000),
    pageSize: intParam(params.get('pageSize'), 25, 1, 100),
  }
}

async function route(req: Request, ip: string): Promise<Response> {
  const url = new URL(req.url)
  const parts = url.pathname.split('/').filter(Boolean)
  const method = req.method
  rateLimit(`ip:${ip}`, 240, 60_000)

  if (method === 'GET' && url.pathname === '/health') {
    const head = await getHead().catch(() => null)
    let db: 'ok' | 'unconfigured' | 'error' = sql ? 'ok' : 'unconfigured'
    if (sql) await sql`select 1`.catch(() => { db = 'error' })
    return json({ ok: true, database: db, rpc: head === null ? 'error' : 'ok', rpcSource: config.rpcSource, headBlock: head === null ? null : Number(head), chainId: config.chainId })
  }

  if (parts[0] === 'across' && method === 'GET') return proxyAcross(`/${parts.slice(1).join('/')}`, url.searchParams)

  if (parts[0] === 'uniswap') {
    rateLimit(`uniswap:${ip}`, 90, 60_000)
    if (parts[1] === 'status' && method === 'GET') return json(await uniswapStatus())
    if (method === 'POST' && parts.length === 2) {
      const body = await readJson<Record<string, unknown>>(req, 200_000)
      if (parts[1] === 'quote') return json(await getQuote(body))
      if (parts[1] === 'check_approval') return json(await checkApproval(body))
      if (parts[1] === 'swap') return json(await createSwap(body))
    }
  }

  if (parts[0] === 'activity') {
    requireDb()
    if (parts[1] === 'swap' && method === 'POST') {
      rateLimit(`activity:${ip}`, 30, 60_000)
      return json(await recordSwap((await readJson<{ txHash?: unknown }>(req)).txHash), 201)
    }
    if (parts[1] === 'bridge' && parts.length === 2 && method === 'POST') {
      rateLimit(`activity:${ip}`, 60, 60_000)
      return json(await recordBridge(await readJson(req)))
    }
    if (parts[1] === 'bridge' && parts[2] === 'refresh' && method === 'POST') {
      rateLimit(`activity-refresh:${ip}`, 120, 60_000)
      const body = await readJson<{ txHash?: unknown; originChainId?: unknown }>(req)
      return json({ activity: await refreshBridge(body.txHash, body.originChainId) })
    }
    if (parts.length === 2 && method === 'GET') return json({ activity: await listActivity(parseAddress(parts[1])) })
  }

  if (parts[0] === 'index' && parts.length === 2 && method === 'POST') {
    requireDb()
    rateLimit(`index:${ip}`, 30, 60_000)
    const address = parseAddress(parts[1])
    await registerWallet(address)
    // A send just confirmed or a wallet just connected: allow a fresher tip than reads do, still bounded and single-flight.
    await syncTip(address, 4, 3_000)
    return json(await coverage(address))
  }

  if (parts[0] === 'history' && parts.length === 2 && method === 'GET') {
    requireDb()
    const address = parseAddress(parts[1])
    const filters = filtersFrom(address, url.searchParams)
    // Reads never register wallets; registration is POST /index/:address only.
    await touchWallet(address)
    await syncTip(address, 2)
    if (url.searchParams.get('format') === 'csv') {
      rateLimit(`csv:${ip}`, 10, 60_000)
      const csv = await exportCsv(filters)
      return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="quickpay-${address.slice(0, 8)}.csv"`, 'cache-control': 'no-store' } })
    }
    const [result, cov] = await Promise.all([queryHistory(filters), coverage(address)])
    return json({ ...result, page: filters.page, pageSize: filters.pageSize, coverage: cov })
  }

  if (parts[0] === 'analytics' && parts.length === 2 && method === 'GET') {
    requireDb()
    const address = parseAddress(parts[1])
    // Reads never register wallets; registration is POST /index/:address only.
    await touchWallet(address)
    await syncTip(address, 2)
    const [analytics, cov] = await Promise.all([queryAnalytics(address), coverage(address)])
    return json({ ...analytics, coverage: cov })
  }

  if (parts[0] === 'requests') {
    requireDb()
    if (parts.length === 1 && method === 'POST') {
      const wallet = await requireWallet(req)
      return json(await createRequest(wallet, await readJson(req)), 201)
    }
    if (parts.length === 1 && method === 'GET') return json({ requests: await listRequests(await requireWallet(req)) })
    if (parts.length === 2 && method === 'GET') return json(await getRequest(parts[1]))
    if (parts.length === 3 && parts[2] === 'cancel' && method === 'POST') return json(await cancelRequest(parts[1], await requireWallet(req)))
    if (parts.length === 3 && parts[2] === 'verify' && method === 'POST') {
      const body = await readJson<{ txHash?: unknown }>(req)
      return json(await verifyPayment(parts[1], body.txHash, ip))
    }
  }

  throw new HttpError(404, 'not_found', 'Not found.')
}

const server = Bun.serve({
  port: config.port,
  // Verification calls read other chains and can take longer than Bun's 10 second default.
  idleTimeout: 60,
  // Hard ceiling for any request body (a chunked upload has no content-length to pre-check).
  maxRequestBodySize: 512 * 1024,
  async fetch(req, srv) {
    try {
      return await route(req, srv.requestIP(req)?.address ?? 'local')
    } catch (error) {
      return errorResponse(error)
    }
  },
})

console.log(`[quickpay] api listening on :${server.port} | db=${sql ? 'configured' : 'NOT configured'} | rpc=${config.rpcSource}`)
