/**
 * Measures a production build in `dist/` (or the folder given as the first argument):
 * what a first visit must download.
 *   bun run build && bun run perf:report [dir]
 * Sizes are real file sizes; "download" times are computed for a stated link speed, not measured on a network.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const dir = process.argv[2] ?? 'dist'
const html = readFileSync(join(dir, 'index.html'), 'utf8')
const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`
const info = (path: string) => {
  const buf = readFileSync(join(dir, path))
  return { path, raw: buf.length, gz: gzipSync(buf, { level: 9 }).length, code: path.endsWith('.js') ? buf.toString('utf8') : '' }
}

const initial = [...new Set(refs)].map(info)
const js = initial.filter((f) => f.path.endsWith('.js'))
const css = initial.filter((f) => f.path.endsWith('.css'))
const sum = (list: { raw: number; gz: number }[]) => ({ raw: list.reduce((a, f) => a + f.raw, 0), gz: list.reduce((a, f) => a + f.gz, 0) })

console.log(`Build: ${dir}`)
console.log(`Initial requests besides HTML and fonts: ${initial.length}`)
for (const f of initial) console.log(`  ${f.path.padEnd(48)} ${kb(f.raw).padStart(10)} raw  ${kb(f.gz).padStart(10)} gzip`)
const j = sum(js)
const c = sum(css)
console.log(`Initial JS:  ${kb(j.raw)} raw, ${kb(j.gz)} gzip`)
console.log(`Initial CSS: ${kb(c.raw)} raw, ${kb(c.gz)} gzip`)

const mbps = (bits: number) => ((j.gz + c.gz) * 8) / bits
console.log(`Download of initial JS+CSS, computed: ${mbps(1_600_000).toFixed(2)} s at 1.6 Mbps (slow 3G), ${mbps(10_000_000).toFixed(2)} s at 10 Mbps`)

const all = readdirSync(join(dir, 'assets')).filter((f) => f.endsWith('.js'))
const sizeOf = (prefix: string) => {
  const f = all.find((n) => n.startsWith(`${prefix}-`))
  return f ? `${kb(statSync(join(dir, 'assets', f)).size)} raw` : 'n/a'
}
console.log('Route chunks (loaded on navigation):')
for (const name of ['Overview', 'Swap', 'Bridge', 'Scan', 'TransferExplorer', 'Send', 'Receive', 'Requests', 'Settings']) console.log(`  ${name.padEnd(18)} ${sizeOf(name)}`)
const total = all.reduce((a, n) => a + statSync(join(dir, 'assets', n)).size, 0)
console.log(`All JS in build: ${kb(total)} raw (${all.length} files)`)
