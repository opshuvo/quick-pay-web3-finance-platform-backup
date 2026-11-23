import { useMemo, useRef, useState } from 'react'
import { createPublicClient, erc20Abi, http, isAddress, parseUnits, zeroAddress, type Address, type EIP1193Provider } from 'viem'
import { useAccount, useBalance, useReadContract, useSwitchChain } from 'wagmi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { BridgeAmount, NetworkRow, ReverseButton, RoutePair } from '@/components/BridgeCard'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { TxProgress } from '@/components/TxProgress'
import { Field, Notice, Row, Skeleton, Spinner } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { BRIDGE_ORIGIN_CHAIN_IDS } from '@/config'
import { useArcWallet } from '@/hooks/useArcWallet'
import { useDebounced } from '@/hooks/useDebounced'
import { ARC_CHAIN_ID } from '@/lib/arc'
import { saveBridge } from '@/lib/bridgeStore'
import { recordConfirmedTx } from '@/lib/chainHistory/record'
import { buildCircleAdapter, CIRCLE_URL, estimateCircle, loadCircleChains, runCircleTransfer, serializeResult, summarizeCircleResult, type CircleChain, type CircleTransferInput } from '@/lib/circle'
import { sumUsdcFees, type CircleMode, type CircleRecord, type CircleSpeed } from '@/lib/circleStatus'
import { parseTxError } from '@/lib/errors'
import { displayUnits } from '@/lib/format'
import { Amount, formatUnitsExact, parseUnitsExact, usdcToGasToken } from '@/onchain-money'

const FEE_LABEL: Record<string, string> = { forwarder: 'Circle forwarding fee', provider: 'Circle fast-transfer fee' }
const USDC_DECIMALS = 6

type Run = { stage: 'idle' | 'wallet' | 'confirming' | 'success' | 'error'; hash?: `0x${string}`; note?: string; error?: string; keepClosed?: boolean }

/** Circle's official USDC bridge (CCTP). Quotes are live fee estimates from Circle; only the user's own wallet signs. */
export function CircleBridge({ onStarted, disabled }: { onStarted: () => void; disabled?: boolean }) {
  const wallet = useArcWallet()
  const { connector } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const queryClient = useQueryClient()
  const [origin, setOrigin] = useState<number>(ARC_CHAIN_ID)
  const [destination, setDestination] = useState<number>(1)
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')
  const [speed, setSpeed] = useState<CircleSpeed>('FAST')
  const [preferSelf, setPreferSelf] = useState(false)
  const [open, setOpen] = useState(false)
  const [run, setRun] = useState<Run>({ stage: 'idle' })
  const lock = useRef(false)

  const chains = useQuery({ queryKey: ['circle-chains'], queryFn: loadCircleChains, staleTime: Infinity, retry: 1 })
  const list = useMemo(() => chains.data ?? [], [chains.data])
  const from = list.find((c) => c.chainId === origin)
  const to = list.find((c) => c.chainId === destination)
  const originOptions = useMemo(() => list.filter((c) => BRIDGE_ORIGIN_CHAIN_IDS.includes(c.chainId)), [list])
  const destinationOptions = useMemo(() => list.filter((c) => c.chainId !== origin), [list, origin])
  const mode: CircleMode = to?.forwarder && !preferSelf ? 'forwarder' : 'self'

  const balance = useReadContract({ address: from?.usdc, abi: erc20Abi, functionName: 'balanceOf', args: wallet.address ? [wallet.address] : undefined, chainId: origin, query: { enabled: Boolean(from && wallet.address), refetchInterval: 20_000 } })
  const native = useBalance({ address: wallet.address, chainId: origin, query: { enabled: Boolean(wallet.address), refetchInterval: 20_000 } })

  const amountRaw = useMemo(() => {
    if (!/^\d*\.?\d+$/.test(amount)) return undefined
    try {
      const v = parseUnitsExact(amount, USDC_DECIMALS)
      return v > 0n ? v : undefined
    } catch {
      return undefined
    }
  }, [amount])
  const tooManyDecimals = (amount.split('.')[1]?.length ?? 0) > USDC_DECIMALS
  const debounced = useDebounced(amountRaw?.toString(), 600)
  const recipientAddress = (recipient || wallet.address) as Address | undefined
  const recipientError = recipient && !isAddress(recipient) ? 'Enter a valid EVM address.' : recipient && recipient.toLowerCase() === zeroAddress ? 'The zero address cannot receive funds.' : null
  const overBalance = amountRaw !== undefined && balance.data !== undefined && amountRaw > balance.data

  const estimate = useQuery({
    queryKey: ['circle-estimate', origin, destination, debounced, recipientAddress, mode, speed, wallet.address],
    enabled: Boolean(from && to && connector && debounced && recipientAddress && !recipientError && !overBalance),
    retry: false,
    staleTime: 30_000,
    refetchInterval: 45_000,
    queryFn: async () => {
      const provider = (await (connector as NonNullable<typeof connector>).getProvider()) as EIP1193Provider
      const adapter = await buildCircleAdapter(provider, list)
      return estimateCircle({ adapter, from: from as CircleChain, to: to as CircleChain, amount: formatUnitsExact(BigInt(debounced as string), USDC_DECIMALS), recipient: recipientAddress as Address, mode, speed })
    },
  })
  const est = estimate.data
  const usdcFees = est ? sumUsdcFees(est.fees, (v) => parseUnits(v, USDC_DECIMALS)) : 0n
  const netReceive = est && amountRaw !== undefined && debounced === amountRaw.toString() ? amountRaw - usdcFees : undefined

  // Gas on the source chain: steps there (approve, burn) are paid in its native token. On Arc that token is USDC itself.
  const sourceGas = est && from ? est.gasFees.filter((g) => g.blockchain === from.kit).reduce((sum, g) => sum + (g.fee ? parseUnits(g.fee, 18) : 0n), 0n) : undefined
  const gasNeeded = sourceGas !== undefined && amountRaw !== undefined ? sourceGas + (origin === ARC_CHAIN_ID ? usdcToGasToken(ARC_CHAIN_ID, Amount.fromRaw(amountRaw, USDC_DECIMALS)).raw : 0n) : undefined
  const gasOk = gasNeeded !== undefined && native.data ? native.data.value >= gasNeeded : undefined
  // Minting yourself needs the destination chain's gas token too.
  const mintFee = mode === 'self' && est && to ? est.gasFees.find((g) => g.blockchain === to.kit && g.name.toLowerCase().includes('mint'))?.fee : undefined
  const destGas = useQuery({
    queryKey: ['circle-dest-gas', destination, wallet.address],
    enabled: Boolean(mode === 'self' && to && wallet.address),
    retry: 1,
    queryFn: () => createPublicClient({ transport: http((to as CircleChain).rpc) }).getBalance({ address: wallet.address as Address }),
  })
  const destGasOk = mode !== 'self' ? true : destGas.data === undefined || !mintFee ? undefined : destGas.data >= parseUnits(mintFee, 18)

  const failure = estimate.isError ? 'Circle does not offer this transfer right now, or could not price it. Nothing was assumed: try again, or pick another route.' : null
  const canReview = Boolean(est && netReceive !== undefined && netReceive > 0n && !overBalance && !recipientError && gasOk !== false && destGasOk !== false && !disabled)
  const busy = run.stage === 'wallet' || run.stage === 'confirming'

  async function confirm() {
    if (lock.current || !wallet.address || !connector || !from || !to || amountRaw === undefined || !recipientAddress) return
    lock.current = true
    setRun({ stage: 'wallet', note: 'Preparing your transfer…' })
    let burn: `0x${string}` | undefined
    const base = { hash: undefined as `0x${string}` | undefined, originChainId: origin, destinationChainId: destination, amount: displayUnits(amountRaw, USDC_DECIMALS, 2, 6), symbol: 'USDC', createdAt: Date.now(), provider: 'circle' as const, wallet: wallet.address, recipient: recipientAddress, inputToken: from.usdc, outputToken: to.usdc, inputSymbol: 'USDC', inputDecimals: USDC_DECIMALS, outputSymbol: 'USDC', outputDecimals: USDC_DECIMALS }
    const record: CircleRecord = { mode, speed, fromKit: from.kit, toKit: to.kit, fromDomain: from.domain, toDomain: to.domain, toRpc: to.rpc }
    const save = (hash: `0x${string}`, extra?: Partial<CircleRecord>) => saveBridge(wallet.address as string, { ...base, hash, circle: { ...record, ...extra } })
    try {
      if (wallet.chainId !== origin) {
        setRun({ stage: 'wallet', note: `Switch your wallet to ${from.name}…` })
        await switchChainAsync({ chainId: origin })
      }
      const provider = (await connector.getProvider()) as EIP1193Provider
      const adapter = await buildCircleAdapter(provider, list)
      const input: CircleTransferInput = { adapter, from, to, amount: formatUnitsExact(amountRaw, USDC_DECIMALS), recipient: recipientAddress, mode, speed }
      setRun({ stage: 'wallet', note: 'Approve the exact amount, then confirm the burn in your wallet…' })
      const result = await runCircleTransfer(input, (p) => {
        if (p.step === 'burn' && p.txHash && !burn) {
          burn = p.txHash
          save(p.txHash)
          onStarted()
          setRun({ stage: 'confirming', hash: p.txHash, note: 'Burn submitted. Waiting for Circle and the destination chain. Keep this page open.' })
        }
        if (p.step === 'mint' && p.txHash && burn) save(burn, { mintTx: p.txHash })
      })
      const s = summarizeCircleResult(result)
      burn = s.burn ?? burn
      if (burn) save(burn, { mintTx: s.mint, resumable: result.state === 'success' ? undefined : serializeResult(result) })
      if (burn && origin === ARC_CHAIN_ID) void recordConfirmedTx({ address: wallet.address, hash: burn, queryClient })
      if (result.state === 'success') {
        setRun({ stage: 'success', hash: burn, note: 'Circle reports the transfer finished. Delivery is verified on the destination chain below.', keepClosed: true })
      } else if (burn) {
        setRun({ stage: 'error', hash: burn, error: `The transfer stopped at "${s.failedStep ?? 'a step'}"${s.failedMessage ? `: ${s.failedMessage}` : ''}. Your USDC was burned on ${from.name} and is not lost. Do not start a new transfer: resume this one from Bridge progress.`, keepClosed: true })
      } else {
        setRun({ stage: 'error', error: s.userRejected ? 'You cancelled in your wallet. Nothing was bridged.' : `${s.failedMessage ?? 'The transfer could not start.'} Nothing was bridged.` })
      }
    } catch (error) {
      setRun(burn
        ? { stage: 'error', hash: burn, error: 'The transfer was interrupted after the burn. Your USDC is not lost. Do not start a new transfer: follow or resume this one from Bridge progress.', keepClosed: true }
        : { stage: 'error', error: parseTxError(error).message })
    } finally {
      lock.current = false
      void balance.refetch()
    }
  }

  const canReverse = !busy && originOptions.some((c) => c.chainId === destination)
  const ready = chains.isSuccess && from && to

  return (
    <div className="card space-y-4 p-5">
      <div className="inner p-4">
        <NetworkRow label="FROM" value={origin} options={originOptions} loading={chains.isLoading} className="mb-3" onChange={(v) => { setOrigin(v); if (v === destination) setDestination(v === ARC_CHAIN_ID ? 1 : ARC_CHAIN_ID) }} />
        <ReverseButton onClick={() => { setOrigin(destination); setDestination(origin); setAmount('') }} disabled={!canReverse} title={canReverse ? 'Swap From and To' : 'Bridging from that network is not available in this wallet'} />
        <NetworkRow label="TO" value={destination} options={destinationOptions} loading={chains.isLoading} className="mb-4 mt-1" onChange={setDestination} />
        {chains.isLoading ? <Skeleton className="h-24" /> : ready ? (
          <BridgeAmount
            value={amount}
            onChange={setAmount}
            symbol="USDC"
            balance={balance.data}
            decimals={USDC_DECIMALS}
            balanceLoading={balance.isLoading}
            onMax={balance.data !== undefined ? () => setAmount(formatUnitsExact(balance.data, USDC_DECIMALS)) : undefined}
          />
        ) : null}
      </div>

      {chains.isError && <Notice tone="danger" action={<a className="btn btn-ghost" href={CIRCLE_URL} target="_blank" rel="noopener noreferrer">circle.com <ExternalLink className="size-4" aria-hidden /></a>}>Could not load Circle's supported networks. Reload to try again.</Notice>}
      {ready && !chains.isError && originOptions.length > 0 && !originOptions.some((c) => c.chainId === origin) && <Notice tone="warn">Your wallet setup cannot start a transfer from {from.name}. Pick another source network.</Notice>}
      {ready && (
        <>
          {tooManyDecimals && <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>USDC supports at most {USDC_DECIMALS} decimal places.</p>}
          {overBalance && <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>Amount is larger than your USDC balance on {from.name}.</p>}
          {origin === ARC_CHAIN_ID && <p className="text-xs" style={{ color: 'var(--muted)' }}>USDC is also Arc's gas token. Leave a little for the network fee.</p>}
          <div className="segmented" role="tablist" aria-label="Transfer speed">
            {(['FAST', 'SLOW'] as const).map((s) => <button key={s} role="tab" aria-selected={speed === s} disabled={busy} className="seg-item" onClick={() => setSpeed(s)}>{s === 'FAST' ? 'Fast' : 'Standard'}</button>)}
          </div>
          {to.forwarder ? (
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 size-4 shrink-0" checked={preferSelf} disabled={busy} onChange={(e) => setPreferSelf(e.target.checked)} />
              <span>I will mint on {to.name} myself <span className="block text-xs" style={{ color: 'var(--muted)' }}>Skips Circle's forwarding fee. Needs {to.nativeSymbol} for gas on {to.name} and a second wallet signature.</span></span>
            </label>
          ) : <p className="text-xs" style={{ color: 'var(--muted)' }}>Circle cannot submit the mint on {to.name}, so you sign it yourself and need {to.nativeSymbol} for gas there.</p>}
          <Field label="Recipient on destination (defaults to your wallet)" error={recipientError} hint={recipient ? 'Funds will be minted to this address, not your wallet.' : undefined}>
            <input className="field mono" placeholder={wallet.address ?? '0x…'} value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} spellCheck={false} />
          </Field>
        </>
      )}

      {estimate.isFetching && !est && <Skeleton className="h-40" />}
      {failure && !est && <Notice tone="warn">{failure}</Notice>}
      {est && ready && (
        <div className="inner divide-y px-4" style={{ borderColor: 'var(--border)' }}>
          <Row label="You receive (estimated)">{netReceive !== undefined ? `${displayUnits(netReceive, USDC_DECIMALS, 2, 6)} USDC` : 'Updating…'}</Row>
          {est.fees.map((f) => <Row key={f.type} label={FEE_LABEL[f.type] ?? `${f.type} fee`}>{f.amount ?? 'n/a'} {f.token}</Row>)}
          {est.fees.length === 0 && <Row label="Circle fees">None for this route</Row>}
          {est.gasFees.map((g) => <Row key={`${g.name}-${g.blockchain}`} label={`${g.name} gas (${g.blockchain})`}>{g.fee ?? 'n/a'} {g.token}</Row>)}
          <Row label="Typical arrival">{speed === 'FAST' ? 'About a minute or less' : 'Roughly 15 to 20 minutes'}</Row>
          <Row label="Route">Circle CCTP · {from.name} → {to.name} · {mode === 'forwarder' ? 'Circle submits the mint' : 'You sign the mint'}</Row>
          <Row label="Estimate"><button type="button" aria-label="Refresh estimate" onClick={() => void estimate.refetch()} disabled={estimate.isFetching} className="inline-flex size-8 items-center justify-center rounded-lg"><RefreshCw className={`size-4 ${estimate.isFetching ? 'animate-spin' : ''}`} aria-hidden /></button></Row>
        </div>
      )}
      {gasOk === false && <Notice tone="danger">Your {native.data?.symbol ?? 'gas'} balance on {from?.name} is not enough for the network fee{origin === ARC_CHAIN_ID ? ' plus the amount' : ''}. Add funds or lower the amount.</Notice>}
      {destGasOk === false && <Notice tone="danger">You hold no {to?.nativeSymbol} for the mint on {to?.name}. Add some, or let Circle submit the mint.</Notice>}
      {!wallet.isConnected ? <WalletButton className="w-full" /> : <button className="btn btn-primary w-full" disabled={!canReview} onClick={() => { setRun({ stage: 'idle' }); setOpen(true) }}>Review bridge</button>}
      <p className="text-center text-xs" style={{ color: 'var(--muted)' }}>Powered by <a className="underline" href={CIRCLE_URL} target="_blank" rel="noopener noreferrer">Circle CCTP</a>. Fees shown are live estimates from Circle's SDK, not guarantees.</p>

      <ConfirmSheet open={open && Boolean(est) && Boolean(from) && Boolean(to)} onClose={() => setOpen(false)} title="Confirm bridge" locked={busy}>
        {est && from && to && amountRaw !== undefined && netReceive !== undefined && (
          <div>
            <p className="display text-center text-3xl font-bold tabular-nums">{displayUnits(amountRaw, USDC_DECIMALS, 2, 6)} USDC</p>
            <RoutePair fromId={from.chainId} fromName={from.name} toId={to.chainId} toName={to.name} provider="circle" />
            <div className="inner divide-y px-4" style={{ borderColor: 'var(--border)' }}>
              <Row label="Receive about">{displayUnits(netReceive, USDC_DECIMALS, 2, 6)} USDC</Row>
              <Row label="Recipient"><span className="mono break-all text-xs">{recipientAddress}</span></Row>
              <Row label="Steps">{mode === 'forwarder' ? 'Approve exact amount, burn. Circle then mints.' : `Approve exact amount, burn, then mint on ${to.name} (wallet switches network)`}</Row>
            </div>
            <p className="mt-3 text-xs" style={{ color: 'var(--warn)' }}>Irreversible. USDC is burned on {from.name} and minted on {to.name}. Nothing is sent until you confirm in your wallet.{mode === 'self' ? ' Keep this page open until the mint is done.' : ''}</p>
            <TxProgress stage={run.stage} hash={run.hash} error={run.error} walletText={run.note} successText={run.note ?? 'Burn confirmed'} />
            {run.stage === 'confirming' && run.note && <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>{run.note}</p>}
            {run.keepClosed || run.stage === 'success' ? (
              <button className="btn btn-primary mt-4 w-full" onClick={() => { setOpen(false); setAmount(''); setRun({ stage: 'idle' }) }}>Close</button>
            ) : (
              <button className="btn btn-primary mt-4 w-full" disabled={busy} onClick={() => void confirm()}>{busy && <Spinner />} {run.stage === 'error' ? 'Try again' : 'Confirm bridge'}</button>
            )}
          </div>
        )}
      </ConfirmSheet>
    </div>
  )
}
