/**
 * A read-only stand-in for a browser wallet, used only by the browser audits.
 * It reports one public address as connected and forwards every read to the real Arc RPC.
 * It REJECTS every signature and transaction request, so an audit can never move funds or sign anything.
 */
import type { BrowserContext } from 'playwright-core'

export async function installReadOnlyWallet(ctx: BrowserContext, address: string, rpcUrl = 'https://rpc.mainnet.arc.io/', options: { atomic?: boolean } = {}) {
  await ctx.addInitScript(([addr, rpc, atomic]) => {
    const provider = {
      isMetaMask: true,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [addr]
        if (method === 'eth_chainId') return '0x13b2'
        if (method === 'net_version') return '5042'
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain' || method === 'wallet_revokePermissions') return null
        if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }]
        if (method === 'wallet_getCapabilities') return atomic ? { '0x13b2': { atomic: { status: 'supported' } } } : {}
        if (/^(eth_sendTransaction|eth_sendRawTransaction|personal_sign|eth_sign|eth_signTypedData|wallet_)/.test(method)) {
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        }
        const res = await fetch(rpc as string, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }) })
        const body = await res.json()
        if (body.error) throw Object.assign(new Error(body.error.message), body.error)
        return body.result
      },
      on: () => undefined,
      removeListener: () => undefined,
    }
    ;(window as unknown as { ethereum: unknown }).ethereum = provider
  }, [address, rpcUrl, Boolean(options.atomic)] as const)
}
