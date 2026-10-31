/**
 * Mounts every screen in a DOM (disconnected wallet) and fails on any render-time exception
 * or React error. Run with: bun run test:render
 */
import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from 'bun:test'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectKitProvider } from 'connectkit'
import { config } from '../src/config'
import { ThemeProvider } from '../src/hooks/useTheme'
import App from '../src/App'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SCREENS: [string, RegExp][] = [
  ['/', /Nothing to show yet|No wallet connected/],
  ['/payments', /Move USDC, request it, split it/],
  ['/send', /Send USDC/],
  ['/receive', /Receive USDC/],
  ['/scan', /Scan & Pay/],
  ['/requests', /Payment Requests/],
  ['/history', /Transaction History/],
  ['/swap', /Trade tokens on Arc Mainnet through Uniswap/],
  ['/bridge', /Move USDC between Arc and other chains with Across/],
  ['/analytics', /Analytics/],
  ['/contracts', /QuickPayRegistry/],
  ['/settings', /Appearance/],
]

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
})

describe('screens render without runtime errors', () => {
  setDefaultTimeout(30_000)
  for (const [route, expected] of SCREENS) {
    test(route, async () => {
      const errors = spyOn(console, 'error').mockImplementation(() => undefined)
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const host = document.createElement('div')
      document.body.appendChild(host)
      root = createRoot(host)
      await act(async () => {
        root?.render(
          <WagmiProvider config={config}>
            <QueryClientProvider client={client}>
              <ThemeProvider>
                <ConnectKitProvider>
                  <MemoryRouter initialEntries={[route]}>
                    <App />
                  </MemoryRouter>
                </ConnectKitProvider>
              </ThemeProvider>
            </QueryClientProvider>
          </WagmiProvider>,
        )
      })
      // React only commits resolved lazy chunks when an act scope closes, so polling INSIDE one act
      // can never observe them. Poll for the real page text in short act ticks, up to a hard deadline.
      const deadline = Date.now() + 20_000
      while (!expected.test(document.body.textContent ?? '') && Date.now() < deadline) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
        })
      }
      const reactErrors = errors.mock.calls.map((c) => String(c[0])).filter((m) => /Error|Warning: (Each|Invalid|React)/.test(m) && !/not wrapped in act|ResizeObserver/.test(m))
      errors.mockRestore()
      expect(document.body.textContent ?? '').toMatch(expected)
      expect(reactErrors).toEqual([])
    })
  }
})
