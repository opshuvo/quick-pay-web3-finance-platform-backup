/**
 * Logos and the network picker. Run with: bun run test:render
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync, readdirSync } from 'node:fs'
import { ChainIcon, NetworkRow, RoutePair, type ChainOption } from '../src/components/BridgeCard'
import { ProviderLogo } from '../src/components/ProviderLogo'
import { TokenIcon } from '../src/components/TokenIcon'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
})

function mount(node: React.ReactNode) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  act(() => root?.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>))
  return host
}

const CHAINS: ChainOption[] = [
  { chainId: 1, name: 'Ethereum' }, { chainId: 10, name: 'Optimism' }, { chainId: 137, name: 'Polygon' },
  { chainId: 42161, name: 'Arbitrum' }, { chainId: 8453, name: 'Base' }, { chainId: 5042, name: 'Arc' },
]

describe('official logos', () => {
  test('provider marks ship with the app as small, safe SVG files', () => {
    const files = readdirSync(new URL('../public/brand', import.meta.url).pathname).sort()
    expect(files).toEqual(['across.svg', 'circle.svg', 'lifi.svg'])
    for (const f of files) {
      const svg = readFileSync(new URL(`../public/brand/${f}`, import.meta.url), 'utf8')
      expect(svg.trimStart().startsWith('<svg')).toBe(true)
      expect(svg.length).toBeLessThan(10_000)
      expect(/<script|onload=|javascript:/i.test(svg)).toBe(false)
    }
  })

  test('every provider renders its own logo file', () => {
    const host = mount(<div><ProviderLogo id="across" /><ProviderLogo id="lifi" /><ProviderLogo id="circle" /></div>)
    expect([...host.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['/brand/across.svg', '/brand/lifi.svg', '/brand/circle.svg'])
  })

  test.each(CHAINS)('$name has a real brand icon, not an initial', ({ chainId, name }) => {
    const host = mount(<ChainIcon chainId={chainId} name={name} />)
    const badge = host.querySelector('[role="img"]')
    expect(badge?.getAttribute('aria-label')).toBe(`${name} logo`)
    expect(badge?.querySelector('svg')).not.toBeNull()
  })

  test('tokens use their brand icon; an unknown token gets a neutral initial', () => {
    const host = mount(<div><TokenIcon symbol="USDC" /><TokenIcon symbol="ETH" /><TokenIcon symbol="USDT" /><TokenIcon symbol="ZZZ" /></div>)
    const badges = [...host.querySelectorAll('[role="img"]')]
    expect(badges.map((b) => b.getAttribute('aria-label'))).toEqual(['USDC logo', 'ETH logo', 'USDT logo'])
    expect(host.textContent).toContain('Z')
  })

  test('the route pair shows both chains and the provider', () => {
    const host = mount(<RoutePair fromId={1} fromName="Ethereum" toId={5042} toName="Arc" provider="lifi" />)
    expect(host.textContent).toContain('Ethereum')
    expect(host.textContent).toContain('Arc')
    expect(host.textContent).toContain('LI.FI')
    expect(host.querySelectorAll('[role="img"]').length).toBe(2)
    expect(host.querySelector('img[src="/brand/lifi.svg"]')).not.toBeNull()
  })
})

describe('network picker', () => {
  function Harness({ onPick }: { onPick: (id: number) => void }) {
    const [value, setValue] = useState(1)
    return <NetworkRow label="FROM" value={value} options={CHAINS} onChange={(id) => { setValue(id); onPick(id) }} />
  }

  test('shows the chosen network with its logo, opens a list with a logo on every row, and marks the chosen one', () => {
    const picked: number[] = []
    const host = mount(<Harness onPick={(id) => picked.push(id)} />)
    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement
    expect(trigger.textContent).toContain('Ethereum')
    expect(trigger.querySelector('svg')).not.toBeNull()
    act(() => trigger.click())
    const options = [...host.querySelectorAll('[role="option"]')]
    expect(options.map((o) => o.textContent)).toEqual(CHAINS.map((c) => c.name))
    for (const o of options) expect(o.querySelector('[role="img"] svg')).not.toBeNull()
    expect(options.filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.textContent)).toEqual(['Ethereum'])
    act(() => (options[5] as HTMLElement).click())
    expect(picked).toEqual([5042])
    expect(host.querySelector('[role="listbox"]')).toBeNull()
    expect((host.querySelector('button[aria-haspopup="listbox"]') as HTMLElement).textContent).toContain('Arc')
  })

  test('Escape closes the list without changing the network', () => {
    const picked: number[] = []
    const host = mount(<Harness onPick={(id) => picked.push(id)} />)
    act(() => (host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement).click())
    expect(host.querySelector('[role="listbox"]')).not.toBeNull()
    act(() => {
      host.firstElementChild?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    const list = host.querySelector('[role="listbox"]')
    act(() => list?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(host.querySelector('[role="listbox"]')).toBeNull()
    expect(picked).toEqual([])
  })
})
