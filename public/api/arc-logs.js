// arc-studio-allow-onchain-literal
/**
 * Quick Pay history relay (Vercel serverless function, served at /api/arc-logs).
 *
 * Returns one wallet's USDC Transfer logs for ONE fixed block window (v=2: Arc's system Transfer log, which also covers plain native sends; without v the USDC contract's own log, kept for older app versions), read from the official Arc Mainnet RPC.
 * The window is a fixed grid (chunk number x 10,000 blocks), and a window that is entirely in the past never changes
 * (Arc has instant finality), so the answer is cached by the CDN and by the browser for a year. The first device that
 * reads a window pays for the RPC calls; everyone after that gets it from the cache with no RPC call and no rate limit.
 *
 * Nothing is invented here: the logs are the node's own answers, filtered by the same topics the browser would use.
 * Windows that are not final yet, and every failure, are never cached.
 *
 * The RPC URL and USDC address below are the same values as the chain registry in src/onchain-facts.ts for Arc
 * Mainnet (5042); tests/edgeLogs.test.ts fails if they ever differ. The function runs on Vercel, outside the app
 * bundle, so it cannot import the registry.
 */
const RPC = 'https://rpc.mainnet.arc.io'
const USDC = '0x3600000000000000000000000000000000000000'
/** Arc announces every movement of USDC, native sends included, with a Transfer from this system address (v=2). */
const SYSTEM = '0xfffffffffffffffffffffffffffffffffffffffe'
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const CHUNK = 10_000
/** The node refuses eth_getLogs ranges above 5,001 blocks (measured), so a chunk is read as two halves. */
const HALF = 5_000
const MAX_CHUNK = 1_000_000_000 / CHUNK
/** Vercel stops a function after 10 seconds by default; stay below that so a slow RPC gives a clean, uncached 503. */
const BUDGET_MS = 8_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const hex = (n) => '0x' + n.toString(16)

class Busy extends Error {}

async function rpc(method, params, deadline) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (Date.now() > deadline) throw new Busy('time budget used up')
    let response
    let body
    try {
      response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(Math.max(1_000, Math.min(4_000, deadline - Date.now()))) })
      body = await response.json().catch(() => null)
    } catch {
      await sleep(300 * 2 ** attempt)
      continue
    }
    const limited = response.status === 429 || body?.error?.code === -32005
    if (limited || response.status >= 500) {
      await sleep(Math.min(3_000, 400 * 2 ** attempt) * (0.5 + Math.random() / 2))
      continue
    }
    if (!response.ok || !body || body.error) throw new Error(body?.error?.message ?? `RPC answered ${response.status}`)
    return body.result
  }
  throw new Busy('the RPC is busy')
}

function send(res, status, payload, cacheable) {
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', cacheable ? 'public, max-age=31536000, s-maxage=31536000, immutable' : 'no-store')
  res.status(status).send(JSON.stringify(payload))
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' }, false)
  const address = String(req.query.address ?? '')
  const chunk = Number(req.query.chunk)
  if (!/^0x[0-9a-f]{40}$/.test(address)) return send(res, 400, { error: 'bad_address', message: 'Use a lowercase 0x address.' }, false)
  if (!Number.isInteger(chunk) || chunk < 0 || chunk > MAX_CHUNK) return send(res, 400, { error: 'bad_chunk' }, false)

  const from = chunk * CHUNK
  const to = from + CHUNK - 1
  const source = req.query.v === '2' ? SYSTEM : USDC
  const deadline = Date.now() + BUDGET_MS
  try {
    const head = parseInt(await rpc('eth_blockNumber', [], deadline), 16)
    // A window that reaches the chain tip is still growing: it is read directly by the browser instead.
    if (to > head) return send(res, 409, { error: 'not_final', head }, false)

    const w = '0x' + address.slice(2).padStart(64, '0')
    const logs = new Map()
    for (const start of [from, from + HALF]) {
      for (const topics of [[TRANSFER, w], [TRANSFER, null, w]]) {
        const found = await rpc('eth_getLogs', [{ address: source, fromBlock: hex(start), toBlock: hex(start + HALF - 1), topics }], deadline)
        for (const log of found) {
          if (log.topics.length === 3) logs.set(`${log.transactionHash}:${log.logIndex}`, { transactionHash: log.transactionHash, logIndex: log.logIndex, blockNumber: log.blockNumber, topics: log.topics, data: log.data })
        }
      }
    }
    const times = []
    for (const block of new Set([...logs.values()].map((l) => l.blockNumber))) {
      const found = await rpc('eth_getBlockByNumber', [block, false], deadline)
      times.push([parseInt(block, 16), parseInt(found.timestamp, 16)])
    }
    return send(res, 200, { chunk, from, to, logs: [...logs.values()], times }, true)
  } catch (error) {
    return send(res, error instanceof Busy ? 503 : 502, { error: error instanceof Busy ? 'rpc_busy' : 'rpc_error' }, false)
  }
}
