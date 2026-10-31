import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// Regression guard on the route table: reads must never create wallets. (The behaviour itself is checked
// against a running server in tests/api.smoke.ts.)
const source = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8')
function block(start: string): string {
  const from = source.indexOf(start)
  expect(from).toBeGreaterThan(-1)
  const next = source.indexOf("\n  if (parts[0] ===", from + start.length)
  return source.slice(from, next === -1 ? undefined : next)
}

describe('GET routes', () => {
  test('history and analytics never call registerWallet', () => {
    for (const route of ["parts[0] === 'history'", "parts[0] === 'analytics'"]) {
      const body = block(route)
      expect(body).not.toContain('registerWallet')
      expect(body).toContain('touchWallet')
      expect(body).toContain('syncTip')
    }
  })
  test('only POST /index registers wallets', () => {
    const body = block("parts[0] === 'index'")
    expect(body).toContain("method === 'POST'")
    expect(body).toContain('registerWallet')
    expect(source.match(/registerWallet\(/g)?.length).toBe(1)
  })
})
