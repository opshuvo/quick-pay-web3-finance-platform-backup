import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { RegistryActions } from '@/components/RegistryActions'
import { AddressChip, ExplorerLink, Notice, PageHeader, Row, Skeleton, StatusBadge } from '@/components/ui'
import { quickPayRegistryAbi } from '@/contracts/quickPayRegistryAbi'
import { ARC_CHAIN_ID, ARC_USDC, arcAddressUrl } from '@/lib/arc'
import { env } from '@/lib/env'

type Deployment =
  | { state: 'not-deployed'; reason: string }
  | { state: 'mismatch'; reason: string }
  | { state: 'verified'; owner: string; paused: boolean; count: bigint }

function useDeployment(): { isLoading: boolean; data?: Deployment } {
  const client = usePublicClient({ chainId: ARC_CHAIN_ID })
  const address = env.registryAddress
  return useQuery({
    queryKey: ['registry-deployment', address],
    enabled: Boolean(client),
    refetchInterval: 60_000,
    queryFn: async (): Promise<Deployment> => {
      if (!address) return { state: 'not-deployed', reason: 'No registry address is configured (VITE_QUICKPAY_REGISTRY_ADDRESS).' }
      if (!client) throw new Error('no client')
      const code = await client.getCode({ address })
      if (!code || code === '0x') return { state: 'not-deployed', reason: 'The configured address has no contract code on Arc Mainnet.' }
      try {
        const read = <F extends 'usdc' | 'owner' | 'paused' | 'requestCount'>(functionName: F) => client.readContract({ address, abi: quickPayRegistryAbi, functionName })
        const [usdc, owner, paused, count] = await Promise.all([read('usdc'), read('owner'), read('paused'), read('requestCount')])
        if (usdc.toLowerCase() !== ARC_USDC.toLowerCase()) return { state: 'mismatch', reason: 'The contract points at a different USDC address than the official Arc USDC.' }
        return { state: 'verified', owner, paused, count }
      } catch {
        return { state: 'mismatch', reason: 'Code exists at that address but it does not behave like QuickPayRegistry.' }
      }
    },
  })
}

const SCRIPTS = `# 1. Build and test
bun run contracts:build
bun run contracts:test

# 2. Deploy (keystore signer, never a raw private key in a command)
cast wallet import quickpay-deployer --interactive
export USDC=${ARC_USDC}
export REGISTRY_OWNER=<multisig or admin address>
forge script contracts/script/DeployQuickPayRegistry.s.sol \\
  --rpc-url <ARC_MAINNET_RPC_URL> --account quickpay-deployer \\
  --sender <deployer address> --broadcast

# 3. Point the app at it (public value), then restart the dev server
echo "VITE_QUICKPAY_REGISTRY_ADDRESS=<deployed address>" >> .env`

export default function Contracts() {
  const deployment = useDeployment()
  const functions = useMemo(() => quickPayRegistryAbi.filter((e) => e.type === 'function'), [])
  const events = useMemo(() => quickPayRegistryAbi.filter((e) => e.type === 'event'), [])
  const d = deployment.data

  return (
    <div className="space-y-6">
      <PageHeader title="Smart Contracts" subtitle="QuickPayRegistry: an optional, non-custodial on-chain record of payment requests and receipts." />

      <section className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="display text-lg font-semibold">QuickPayRegistry on Arc Mainnet</h2>
          {deployment.isLoading || !d ? <Skeleton className="h-6 w-28" /> : d.state === 'verified' ? <StatusBadge tone="success">Deployed and verified on-chain</StatusBadge> : d.state === 'mismatch' ? <StatusBadge tone="danger">Address does not match</StatusBadge> : <StatusBadge tone="neutral">Not Deployed</StatusBadge>}
        </div>
        {d?.state === 'verified' && env.registryAddress ? (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            <Row label="Address"><AddressChip address={env.registryAddress} /></Row>
            <Row label="Owner (pause rights only)"><AddressChip address={d.owner} /></Row>
            <Row label="State">{d.paused ? <StatusBadge tone="warn">Paused</StatusBadge> : <StatusBadge tone="success">Active</StatusBadge>}</Row>
            <Row label="Requests created">{d.count.toString()}</Row>
            <Row label="Explorer"><ExplorerLink href={arcAddressUrl(env.registryAddress)}>View contract</ExplorerLink></Row>
          </div>
        ) : d && d.state !== 'verified' ? (
          <Notice tone={d.state === 'mismatch' ? 'danger' : 'info'}>{d.reason} Quick Pay payments, requests, and history work without the contract. Deploy it yourself using the steps below.</Notice>
        ) : null}
        <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>Status comes from live reads on Arc. It says deployed only if the code exists, matches the registry interface, and uses the official USDC address. It does not mean the contract has been independently audited.</p>
      </section>

      {d?.state === 'verified' && env.registryAddress && <RegistryActions registry={env.registryAddress} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="display mb-2 text-lg font-semibold">What it does</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm" style={{ color: 'var(--ink-2)' }}>
            <li>Merchants create a request: amount, optional payer, optional expiry.</li>
            <li>A payer pays it; USDC moves directly from payer to merchant. The registry never holds funds.</li>
            <li>Every state change emits an event; the payment event is the on-chain receipt.</li>
            <li>The owner can only pause or unpause new requests and payments. Merchants can always cancel their own open requests.</li>
            <li>No fees, no upgradeability, and no escrow. Escrow, if ever added, would be a separate module with its own audit.</li>
          </ul>
          <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>Reviewed with automated analysis and unit and fuzz tests. This is not a substitute for an independent professional audit before mainnet use.</p>
        </section>
        <section className="card p-5">
          <h2 className="display mb-2 text-lg font-semibold">Interface</h2>
          <p className="label mb-1.5">Functions</p>
          <ul className="mono mb-3 space-y-1 text-xs">
            {functions.map((f) => (
              <li key={f.name} style={{ color: f.stateMutability === 'view' ? 'var(--muted)' : 'var(--ink)' }}>
                {f.name}({f.inputs.map((i) => i.type).join(', ')}) <span style={{ color: 'var(--subtle)' }}>{f.stateMutability === 'view' ? 'read' : 'write'}</span>
              </li>
            ))}
          </ul>
          <p className="label mb-1.5">Events</p>
          <ul className="mono space-y-1 text-xs" style={{ color: 'var(--muted)' }}>{events.map((e) => <li key={e.name}>{e.name}</li>)}</ul>
        </section>
      </div>

      <section className="card p-5">
        <h2 className="display mb-2 text-lg font-semibold">Deploy and verify (you run this, outside Arc Studio)</h2>
        <pre className="mono overflow-x-auto rounded-2xl p-4 text-xs" style={{ background: 'var(--surface-muted)' }}>{SCRIPTS}</pre>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm" style={{ color: 'var(--ink-2)' }}>
          <li>Use a hardware wallet or encrypted keystore for the deployer. Never put a private key in frontend code or a committed file.</li>
          <li>Use a multisig as <span className="mono">REGISTRY_OWNER</span>: it controls pause rights.</li>
          <li>Verify source on the Arc explorer following its contract-verification instructions. <span className="mono">forge flatten contracts/QuickPayRegistry.sol</span> produces a single file; use compiler 0.8.28, Cancun EVM, optimizer on with 200 runs, and constructor arguments (USDC address, owner).</li>
          <li>Commission an independent audit and a mainnet dry run with small amounts before real use.</li>
        </ul>
      </section>
    </div>
  )
}
