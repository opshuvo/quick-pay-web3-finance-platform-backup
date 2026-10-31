/**
 * Points the production site's `/api/*` at your hosted backend by editing public/vercel.json.
 *   bun run backend:url https://your-backend.example.com
 * The backend routes have no `/api` prefix, so `/api/health` is forwarded to `<backend>/health`.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const raw = process.argv[2]?.trim()
if (!raw) {
  console.error('Usage: bun run backend:url https://your-backend.example.com')
  process.exit(1)
}

let url: URL
try {
  url = new URL(raw)
} catch {
  console.error(`Not a valid URL: ${raw}`)
  process.exit(1)
}
if (url.protocol !== 'https:') {
  console.error('The backend URL must use https.')
  process.exit(1)
}
const base = `${url.origin}${url.pathname.replace(/\/+$/, '')}`

const file = new URL('../public/vercel.json', import.meta.url)
const config = JSON.parse(readFileSync(file, 'utf8')) as { rewrites: { source: string; destination: string }[] }
const own = (r: { source: string }) => r.source === '/api/health' || r.source === '/api/:path*'
const rewrites = config.rewrites.filter((r) => !own(r))
const catchAll = rewrites.findIndex((r) => r.source === '/(.*)')
const backend = { source: '/api/:path*', destination: `${base}/:path*` }
// Specific Across proxy rewrites stay first; the backend rewrite goes before the SPA catch-all.
rewrites.splice(catchAll === -1 ? rewrites.length : catchAll, 0, backend)
writeFileSync(file, `${JSON.stringify({ ...config, rewrites }, null, 2)}\n`)
console.log(`public/vercel.json: /api/* -> ${base}/*`)
