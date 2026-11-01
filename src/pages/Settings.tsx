import { useConfig, useDisconnect } from 'wagmi'
import { Moon, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { AddressChip, PageHeader, Row, Skeleton, StatusBadge } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { useHealth } from '@/hooks/useHealth'
import { clearSession } from '@/hooks/useSession'
import { useTheme } from '@/hooks/useTheme'
import { ARC_CHAIN_ID, ARC_EXPLORER, ARC_RPC_URL, ARC_USDC, arcAddressUrl } from '@/lib/arc'
import { formatNumber } from '@/lib/format'

export default function Settings() {
  const { theme, setTheme } = useTheme()
  const wallet = useArcWallet()
  const health = useHealth()
  const config = useConfig()
  const { disconnect } = useDisconnect()
  const chainName = config.chains.find((c) => c.id === wallet.chainId)?.name

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Settings" subtitle="Appearance, wallet, network, and service status." />

      <section className="card p-5">
        <h2 className="display mb-3 text-lg font-semibold">Appearance</h2>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Theme">
          {([['dark', 'Dark', Moon], ['light', 'Light', Sun]] as const).map(([id, label, Icon]) => (
            <button key={id} role="radio" aria-checked={theme === id} onClick={() => setTheme(id)} className="btn" style={{ background: theme === id ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'var(--surface-muted)', color: theme === id ? 'var(--accent-ink)' : 'var(--ink)', border: '1px solid var(--border)' }}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="display mb-2 text-lg font-semibold">Wallet</h2>
        {wallet.isConnected && wallet.address ? (
          <>
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              <Row label="Address"><AddressChip address={wallet.address} /></Row>
              <Row label="Connector">{wallet.connectorName ?? '—'}</Row>
              <Row label="Wallet network">{wallet.wrongNetwork ? <StatusBadge tone="warn">{chainName ?? `Chain ${wallet.chainId}`}</StatusBadge> : <StatusBadge tone="success">Arc Mainnet</StatusBadge>}</Row>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {wallet.wrongNetwork && <button className="btn btn-primary" onClick={() => void wallet.switchToArc()}>Switch to Arc</button>}
              <button className="btn btn-ghost" onClick={() => { clearSession(); disconnect(); toast.success('Disconnected') }}>Disconnect</button>
              <button className="btn btn-ghost" onClick={() => { clearSession(); toast.success('Signed out of Quick Pay requests') }}>Sign out of requests</button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3"><p className="text-sm" style={{ color: 'var(--muted)' }}>No wallet connected. Quick Pay never asks for a seed phrase or private key.</p><WalletButton /></div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="display mb-2 text-lg font-semibold">Network</h2>
        <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
          <Row label="Network">Arc Mainnet</Row>
          <Row label="Chain ID">{ARC_CHAIN_ID} (0x{ARC_CHAIN_ID.toString(16)})</Row>
          <Row label="RPC"><span className="mono text-xs">{ARC_RPC_URL}</span></Row>
          <Row label="Explorer"><a className="font-semibold underline" href={ARC_EXPLORER} target="_blank" rel="noopener noreferrer">{ARC_EXPLORER.replace('https://', '')}</a></Row>
          <Row label="USDC contract"><a className="mono text-xs underline" href={arcAddressUrl(ARC_USDC)} target="_blank" rel="noopener noreferrer">{ARC_USDC}</a></Row>
          <Row label="Gas token">USDC (one balance, shown in 6 decimals)</Row>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="display mb-2 text-lg font-semibold">Service status</h2>
        {health.isLoading ? <Skeleton className="h-24" /> : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            <Row label="Quick Pay API">{health.isError ? <StatusBadge tone="danger">Unreachable</StatusBadge> : health.data?.mode === 'browser' ? <StatusBadge tone="warn">Not connected (reading Arc directly)</StatusBadge> : <StatusBadge tone="success">Online</StatusBadge>}</Row>
            <Row label="Database">{health.data?.database === 'ok' ? <StatusBadge tone="success">Connected</StatusBadge> : health.data?.database === 'unconfigured' ? <StatusBadge tone="warn">Not configured</StatusBadge> : <StatusBadge tone="danger">Error</StatusBadge>}</Row>
            <Row label="Arc RPC">{health.data?.rpc === 'ok' ? <StatusBadge tone="success">Online ({health.data.rpcSource === 'proxy' ? 'keyed' : 'public'})</StatusBadge> : <StatusBadge tone="danger">Unreachable</StatusBadge>}</Row>
            <Row label="Latest block">{health.data?.headBlock ? formatNumber(health.data.headBlock) : '—'}</Row>
          </div>
        )}
      </section>

      <p className="text-xs" style={{ color: 'var(--muted)' }}>Quick Pay is software that helps you build and send blockchain transactions. It has not been independently audited. You approve every transaction in your own wallet.</p>
    </div>
  )
}
