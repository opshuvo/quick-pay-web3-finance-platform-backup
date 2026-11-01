/**
 * The wallet button responds at once and the (lazily loaded) wallet picker opens when it is clicked.
 * Run with: bun run test:render
 */
import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from 'bun:test'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { config } from '../src/config'
import { ThemeProvider } from '../src/hooks/useTheme'
import { WalletButton } from '../src/components/WalletButton'
import { WalletModalMount } from '../src/components/WalletModalMount'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
})

describe('wallet button and lazy wallet picker', () => {
  setDefaultTimeout(30_000)
  test('a click before the picker has loaded still opens it', async () => {
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
              <WalletButton />
              <WalletModalMount />
            </ThemeProvider>
          </QueryClientProvider>
        </WagmiProvider>,
      )
    })
    const button = document.querySelector('button[aria-label="Connect wallet"]') as HTMLButtonElement
    expect(button).not.toBeNull()
    expect(button.textContent).toContain('Connect wallet')
    await act(async () => {
      button.click()
    })
    const deadline = Date.now() + 20_000
    // The picker lists wallet options; the button alone never contains these words.
    const opened = () => /Coinbase Wallet/.test(document.body.textContent ?? '')
    while (!opened() && Date.now() < deadline) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
      })
    }
    errors.mockRestore()
    expect(opened()).toBe(true)
  })
})
