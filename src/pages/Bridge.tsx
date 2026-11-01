import { useMemo, useRef, useState } from 'react'
import { erc20Abi, isAddress, zeroAddress, type Address } from 'viem'
import { usePublicClient, useReadContract, useSendTransaction, useSwitchChain, useWriteContract } from 'wagmi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ExternalLink, RefreshCw } from 'lucide-react'
import { ActivityList } from '@/components/ActivityList'
import { AmountInput } from '@/components/AmountInput'
import { BridgeTracker } from '@/components/BridgeTracker'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { TxProgress } from '@/components/TxProgress'
import { Field, Notice, PageHeader, Row, Skeleton, Spinner, StatusBadge } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { useDebounced } from '@/hooks/useDebounced'
import { useGasCheck } from '@/hooks/useGasCheck'
import { useNow } from '@/hooks/useNow'
import { BRIDGE_ORIGIN_CHAIN_IDS } from '@/config'
import { ACROSS_URL, acrossApi, cachedChains, rememberChains, type AcrossQuote, type FeeLine } from '@/lib/across'
import { ApiError } from '@/lib/api'
import { ARC_CHAIN_ID } from '@/lib/arc'
import { assertBridgeQuote, BridgeGuardError, describeFillTime, isQuoteStale } from '@/lib/bridgeGuard'
import { loadBridges, removeBridge, saveBridge, type StoredBridge } from '@/lib/bridgeStore'
import { confirmTx, TxFlowError, TxReplacedError, TxUnconfirmedError } from '@/lib/confirmTx'
import { chainLabel } from '@/lib/chains'
import { parseTxError } from '@/lib/errors'
import { arcFeeParams } from '@/lib/fees'
import { displayUnits, shortAddress } from '@/lib/format'
import { parseUnitsExact } from '@/onchain-money'

const fallbackLink = (
  <a className="btn btn-ghost" href={ACROSS_URL} target="_blank" rel="noopener noreferrer">across.to <ExternalLink className="size-4" aria-hidden /></a>
)

const line = (l: FeeLine | undefined) =>
  l?.token ? `${displayUnits(BigInt(l.amount), l.token.decimals, 2, 6)} ${l.token.symbol}${l.amountUsd ? ` (≈ $${Number(l.amountUsd).toFixed(2)})` : ''}` : undefined


export default function Bridge() {
  const wallet = useArcWallet()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const { sendTransactionAsync } = useSendTransaction()
  const queryClient = useQueryClient()

  const [origin, setOrigin] = useState<number>(ARC_CHAIN_ID)
  const [destination, setDestination] = useState<number>(1)
  const [routeIdx, setRouteIdx] = useState(0)
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')
  const [open, setOpen] = useState(false)
  const [run, setRun] = useState<{ stage: 'idle' | 'wallet' | 'confirming' | 'success' | 'error'; hash?: `0x${string}`; error?: string; note?: string; unconfirmed?: boolean }>({ stage: 'idle' })
  const [storeVersion, setStoreVersion] = useState(0)
  const lock = useRef(false)

  const originClient = usePublicClient({ chainId: origin })
  // The last list Across returned is shown at once and refreshed behind it, so the form never waits on a network call to appear.
  const chains = useQuery({
    queryKey: ['across-chains'],
    staleTime: 5 * 60_000,
    retry: 1,
    initialData: () => cachedChains()?.data,
    initialDataUpdatedAt: () => cachedChains()?.at,
    queryFn: async () => {
      const list = await acrossApi.chains()
      rememberChains(list)
      return list
    },
  })
  const name = (id: number) => chainLabel(chains.data, id)

  // eslint-disable-next-line react-hooks/exhaustive-deps -- storeVersion forces a re-read after saveBridge
  const stored = useMemo(() => (wallet.address ? loadBridges(wallet.address) : []), [wallet.address, storeVersion])

  // Origin chains must be both supported by Across (live list) and executable from this wallet config.
  const originOptions = useMemo(() => (chains.data ?? []).filter((c) => BRIDGE_ORIGIN_CHAIN_IDS.includes(c.chainId)), [chains.data])
  const destinationOptions = useMemo(() => (chains.data ?? []).filter((c) => c.chainId !== origin), [chains.data, origin])

  const routes = useQuery({
    queryKey: ['across-routes', origin, destination],
    enabled: origin !== destination,
    retry: 1,
    staleTime: 60_000,
    queryFn: async () => (await acrossApi.routes(origin, destination)).filter((r) => !r.isNative),
  })
  const route = routes.data?.[Math.min(routeIdx, Math.max(0, (routes.data?.length ?? 1) - 1))]

  const decimals = useReadContract({ address: route?.originToken, abi: erc20Abi, functionName: 'decimals', chainId: origin, query: { enabled: Boolean(route) } })
  const balance = useReadContract({ address: route?.originToken, abi: erc20Abi, functionName: 'balanceOf', args: wallet.address ? [wallet.address] : undefined, chainId: origin, query: { enabled: Boolean(route && wallet.address), refetchInterval: 20_000 } })

  const amountRaw = useMemo(() => {
    if (decimals.data === undefined || !/^\d*\.?\d+$/.test(amount)) return undefined
    try {
      // Exact: an amount with more decimals than the token has is refused, never silently rounded.
      const v = parseUnitsExact(amount, decimals.data)
      return v > 0n ? v : undefined
    } catch {
      return undefined
    }
  }, [amount, decimals.data])
  const tooManyDecimals = decimals.data !== undefined && (amount.split('.')[1]?.length ?? 0) > decimals.data
  const debounced = useDebounced(amountRaw?.toString(), 600)
  const recipientAddress = (recipient || wallet.address) as Address | undefined
  const recipientError = recipient && !isAddress(recipient) ? 'Enter a valid EVM address.' : recipient && recipient.toLowerCase() === zeroAddress ? 'The zero address cannot receive funds.' : null
  const overBalance = amountRaw !== undefined && balance.data !== undefined && amountRaw > balance.data

  const quote = useQuery({
    queryKey: ['across-quote', origin, destination, route?.originToken, route?.destinationToken, debounced, wallet.address, recipientAddress],
    enabled: Boolean(route && debounced && wallet.address && recipientAddress && !recipientError && !overBalance),
    retry: false,
    staleTime: 20_000,
    refetchInterval: 25_000,
    queryFn: () =>
      acrossApi.quote({ amount: BigInt(debounced as string), inputToken: (route as NonNullable<typeof route>).originToken, outputToken: (route as NonNullable<typeof route>).destinationToken, origin, destination, depositor: wallet.address as Address, recipient: recipientAddress as Address }),
  })
  const q = quote.data
  // Tick once a second only while a quote is on screen (the countdown); an idle form does not re-render.
  const now = useNow(1000, Boolean(q))
  const needsApproval = q ? BigInt(q.checks.allowance.actual) < BigInt(q.checks.allowance.expected) : false
  const quoteError = quote.error instanceof ApiError ? quote.error.message : quote.isError ? 'Could not get a quote from Across.' : null
  const gas = useGasCheck(origin, wallet.address, q, needsApproval, amountRaw)
  const secondsLeft = q ? Math.max(0, Math.floor(q.quoteExpiryTimestamp - now / 1000)) : 0
  const expired = Boolean(q) && secondsLeft <= 0 && !quote.isFetching
  const details = q?.fees.total.details
  const bridgeFees = details?.bridge?.details
  const canReview = Boolean(q && !expired && !overBalance && !recipientError && gas.ok !== false)

  function guard(current: AcrossQuote) {
    if (!route) throw new BridgeGuardError('Choose a route first.')
    assertBridgeQuote(current, { origin, destination, originToken: route.originToken, destinationToken: route.destinationToken, amountRaw })
  }

  async function confirm(current: AcrossQuote) {
    if (lock.current || !wallet.address || !originClient || !route) return
    lock.current = true
    setRun({ stage: 'wallet', note: 'Checking your quote…' })
    let deposit: { hash: `0x${string}`; entry: StoredBridge } | undefined
    try {
      if (isQuoteStale(current, Date.now())) {
        void quote.refetch()
        throw new BridgeGuardError('The quote expired and was refreshed. Review it and confirm again.')
      }
      guard(current)
      const tx = current.swapTx
      if (wallet.chainId !== origin) {
        setRun({ stage: 'wallet', note: `Switch your wallet to ${name(origin)}…` })
        await switchChainAsync({ chainId: origin })
      }
      const fees = origin === ARC_CHAIN_ID ? await arcFeeParams(originClient) : {}
      if (needsApproval) {
        setRun({ stage: 'wallet', note: 'Approve exactly this amount in your wallet…' })
        // Exact-amount approval to the spender Across named; never an unlimited allowance.
        const approveHash = await writeContractAsync({ address: current.checks.allowance.token, abi: erc20Abi, functionName: 'approve', args: [current.checks.allowance.spender, BigInt(current.checks.allowance.expected)], chainId: origin, ...fees })
        setRun({ stage: 'confirming', hash: approveHash, note: 'Waiting for the approval to confirm…' })
        const approval = await confirmTx(originClient, approveHash)
        if (approval.receipt.status !== 'success') throw new BridgeGuardError('The approval transaction failed. Nothing was bridged.')
        // The approval can take a while; never deposit against a quote that expired in the meantime.
        if (isQuoteStale(current, Date.now())) {
          void quote.refetch()
          throw new BridgeGuardError('Your approval confirmed, but the quote expired while waiting. Review the refreshed quote and confirm again. Nothing was bridged.')
        }
      }
      setRun({ stage: 'wallet', note: 'Confirm the bridge transfer in your wallet…' })
      const hash = await sendTransactionAsync({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n, chainId: origin, ...(tx.gas ? { gas: BigInt(tx.gas) } : {}), ...fees })
      const entry: StoredBridge = {
        hash, originChainId: origin, destinationChainId: destination, amount: displayUnits(BigInt(current.inputAmount), current.inputToken.decimals, 2, 6), symbol: current.inputToken.symbol, createdAt: Date.now(),
        wallet: wallet.address, inputToken: current.inputToken.address, outputToken: current.outputToken.address, recipient: recipientAddress, expectedOutput: current.expectedOutputAmount, feeAmount: current.fees.total.amount,
        inputSymbol: current.inputToken.symbol, inputDecimals: current.inputToken.decimals, outputSymbol: current.outputToken.symbol, outputDecimals: current.outputToken.decimals,
      }
      saveBridge(wallet.address, entry)
      setStoreVersion((v) => v + 1)
      setRun({ stage: 'confirming', hash, note: 'Waiting for the deposit to confirm on the source chain…' })
      deposit = { hash, entry }
      const confirmed = await confirmTx(originClient, hash)
      if (confirmed.hash !== hash) {
        // The wallet sped the deposit up: track the transaction that actually mined.
        removeBridge(wallet.address, hash)
        saveBridge(wallet.address, { ...entry, hash: confirmed.hash })
        setStoreVersion((v) => v + 1)
      }
      if (confirmed.receipt.status !== 'success') {
        removeBridge(wallet.address, confirmed.hash)
        setStoreVersion((v) => v + 1)
        throw new BridgeGuardError('The deposit transaction failed on-chain. Nothing was bridged.')
      }
      setRun({ stage: 'success', hash: confirmed.hash, note: 'Deposit confirmed on the source chain. Delivery is tracked below and is complete only once verified on the destination.' })
      void balance.refetch()
      for (const key of ['readContract', 'readContracts', 'balance']) void queryClient.invalidateQueries({ queryKey: [key] })
    } catch (error) {
      if (deposit && error instanceof TxReplacedError && wallet.address) {
        if (error.reason === 'cancelled') {
          removeBridge(wallet.address, deposit.hash)
          setStoreVersion((v) => v + 1)
        }
        setRun({ stage: 'error', hash: deposit.hash, error: error.message, unconfirmed: error.reason === 'replaced' })
      } else if (deposit) {
        // The deposit was broadcast; only its outcome is unknown (or it reverted). A blind retry could bridge twice.
        const reverted = error instanceof BridgeGuardError
        setRun({
          stage: 'error',
          hash: deposit.hash,
          unconfirmed: !reverted,
          error: reverted ? error.message : error instanceof TxUnconfirmedError ? 'The deposit was sent but we could not confirm it. It may still go through. Do not send it again: follow its progress below or check the explorer.' : parseTxError(error).message,
        })
      } else {
        setRun({ stage: 'error', error: error instanceof BridgeGuardError || error instanceof TxFlowError ? error.message : parseTxError(error).message })
      }
    } finally {
      lock.current = false
    }
  }

  const busy = run.stage === 'wallet' || run.stage === 'confirming'
  const arrival = q ? describeFillTime(q.expectedFillTime) : ''

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <PageHeader title="Bridge" subtitle="Move USDC between Arc and other chains with Across. Networks, tokens, routes and quotes come live from Across." />
        <div className="space-y-3">
          <Notice tone="warn">Bridging moves <strong>real funds</strong> across chains and cannot be reversed. A route is offered only when Across lists it.</Notice>
          {chains.isError && <Notice tone="danger" action={fallbackLink}>Could not load supported networks from Across. You can bridge directly on across.to.</Notice>}
        </div>
      </div>

      <div className="card space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From network">
            {chains.isLoading ? <Skeleton className="h-12" /> : (
              <select className="field" value={origin} onChange={(e) => { const v = Number(e.target.value); setOrigin(v); if (v === destination) setDestination(v === ARC_CHAIN_ID ? 1 : ARC_CHAIN_ID); setRouteIdx(0) }}>
                {originOptions.map((c) => <option key={c.chainId} value={c.chainId}>{c.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="To network">
            {chains.isLoading ? <Skeleton className="h-12" /> : (
              <select className="field" value={destination} onChange={(e) => { setDestination(Number(e.target.value)); setRouteIdx(0) }}>
                {destinationOptions.map((c) => <option key={c.chainId} value={c.chainId}>{c.name}</option>)}
              </select>
            )}
          </Field>
        </div>

        {routes.isLoading ? <Skeleton className="h-12" /> : routes.isError ? (
          <Notice tone="danger" action={fallbackLink}>Could not check routes with Across. Try again shortly.</Notice>
        ) : !routes.data || routes.data.length === 0 ? (
          <Notice tone="warn" action={fallbackLink}>Unavailable: Across does not list an ERC-20 route from {name(origin)} to {name(destination)}. Quick Pay will not offer one. You can check across.to for other options.</Notice>
        ) : (
          <>
            <Field label="Token">
              <select className="field" value={routeIdx} onChange={(e) => setRouteIdx(Number(e.target.value))}>
                {routes.data.map((r, i) => <option key={`${r.originToken}-${r.destinationToken}`} value={i}>{r.originTokenSymbol} → {r.destinationTokenSymbol}</option>)}
              </select>
            </Field>
            <div>
              <AmountInput
                value={amount}
                onChange={setAmount}
                symbol={route?.originTokenSymbol}
                balance={balance.data}
                balanceLoading={balance.isLoading}
                onMax={balance.data !== undefined && decimals.data !== undefined ? () => setAmount(displayUnits(balance.data, decimals.data, 0, decimals.data).replace(/,/g, '')) : undefined}
              />
 {tooManyDecimals && <p role="alert" className="mt-1.5 text-xs" style={{ color: 'var(--danger)' }}>{route?.originTokenSymbol} supports at most {decimals.data} decimal places.</p>}
              {overBalance && <p role="alert" className="mt-1.5 text-xs" style={{ color: 'var(--danger)' }}>Amount is larger than your balance on {name(origin)}.</p>}
              {origin === ARC_CHAIN_ID && route?.originTokenSymbol === 'USDC' && <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>USDC is also Arc's gas token. Leave a little for the network fee.</p>}
            </div>
            <div className="flex justify-center"><span className="inner flex size-9 items-center justify-center rounded-full"><ArrowDown className="size-4" aria-hidden /></span></div>
            <Field label="Recipient on destination (defaults to your wallet)" error={recipientError} hint={recipient ? 'Funds will be sent to this address, not your wallet.' : undefined}>
              <input className="field mono" placeholder={wallet.address ?? '0x…'} value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} spellCheck={false} />
            </Field>
          </>
        )}

        {quote.isFetching && !q && <Skeleton className="h-40" />}
        {quoteError && !q && <Notice tone="warn" action={fallbackLink}>{quoteError}</Notice>}
        {q && route && (
          <div className="inner divide-y px-4" style={{ borderColor: 'var(--border)' }}>
            <Row label="You receive (estimated)">{displayUnits(BigInt(q.expectedOutputAmount), q.outputToken.decimals, 2, 6)} {q.outputToken.symbol}</Row>
            <Row label="Minimum received">{displayUnits(BigInt(q.minOutputAmount), q.outputToken.decimals, 2, 6)} {q.outputToken.symbol}</Row>
            <Row label="Total fees">{displayUnits(BigInt(q.fees.total.amount), q.fees.total.token.decimals, 2, 6)} {q.fees.total.token.symbol} (≈ ${Number(q.fees.total.amountUsd).toFixed(2)})</Row>
            {line(bridgeFees?.relayerCapital) && <Row label="  Relayer capital fee">{line(bridgeFees?.relayerCapital)}</Row>}
            {line(bridgeFees?.lp) && <Row label="  Liquidity provider fee">{line(bridgeFees?.lp)}</Row>}
            {line(bridgeFees?.destinationGas) && <Row label="  Destination gas">{line(bridgeFees?.destinationGas)}</Row>}
            {line(details?.app) && Number(details?.app?.amount) > 0 && <Row label="  App fee">{line(details?.app)}</Row>}
            <Row label="Estimated arrival">{arrival}</Row>
            <Row label="Route">Across · {name(origin)} → {name(destination)} · {q.inputToken.symbol} → {q.outputToken.symbol}{q.crossSwapType ? ` (${q.crossSwapType})` : ''}</Row>
            <Row label="Quote expires">
              <span className="inline-flex items-center gap-2">
                {expired ? <span style={{ color: 'var(--danger)' }}>Expired</span> : <span className="tabular-nums">in {secondsLeft}s</span>}
                <button type="button" aria-label="Refresh quote" onClick={() => void quote.refetch()} disabled={quote.isFetching} className="inline-flex size-8 items-center justify-center rounded-lg"><RefreshCw className={`size-4 ${quote.isFetching ? 'animate-spin' : ''}`} aria-hidden /></button>
              </span>
            </Row>
            <Row label="Approval">{needsApproval ? 'Required (exact amount)' : 'Already approved'}</Row>
            <Row label="Network fee here (est.)">
              {gas.required !== undefined ? `≈ ${displayUnits(gas.required, 18, 4, 6)} ${gas.symbol ?? ''}` : gas.note ?? 'Checking…'}
            </Row>
          </div>
        )}
        {gas.ok === false && <Notice tone="danger">Your {gas.symbol ?? 'gas token'} balance on {name(origin)} is not enough for the network fee{origin === ARC_CHAIN_ID ? ' plus the amount' : ''}. Add funds or lower the amount.</Notice>}
        {q && gas.ok === undefined && gas.note && <Notice tone="info">{gas.note} Your wallet will show the final fee.</Notice>}

        {!wallet.isConnected ? <WalletButton className="w-full" /> : (
          <button className="btn btn-primary w-full" disabled={!canReview} onClick={() => { setRun({ stage: 'idle' }); setOpen(true) }}>
            {expired ? 'Quote expired, refreshing…' : 'Review bridge'}
          </button>
        )}
        <p className="text-center text-xs" style={{ color: 'var(--muted)' }}>Powered by <a className="underline" href={ACROSS_URL} target="_blank" rel="noopener noreferrer">Across Protocol</a>. Prefer the official app? Use it directly at across.to.</p>
      </div>

      <section className="card p-5">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="display text-lg font-semibold">Bridge progress</h2>
          <StatusBadge tone="neutral">Live</StatusBadge>
        </div>
        <p className="mb-2 text-xs" style={{ color: 'var(--muted)' }}>A transfer is Complete only after the destination transaction is read back from the destination chain.</p>
        {stored.length === 0 ? <p className="py-4 text-sm" style={{ color: 'var(--muted)' }}>No bridges started on this device yet.</p> : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>{stored.map((s) => <BridgeTracker key={s.hash} item={s} chains={chains.data} />)}</ul>
        )}
      </section>

      <ActivityList kind="bridge" title="Verified bridge history" />

      <ConfirmSheet open={open && Boolean(q)} onClose={() => setOpen(false)} title="Confirm bridge" locked={busy}>
        {q && (
          <div>
            <p className="display text-center text-3xl font-bold tabular-nums">{displayUnits(BigInt(q.inputAmount), q.inputToken.decimals, 2, 6)} {q.inputToken.symbol}</p>
            <p className="mb-3 text-center text-sm" style={{ color: 'var(--muted)' }}>{name(origin)} → {name(destination)}</p>
            <div className="inner divide-y px-4" style={{ borderColor: 'var(--border)' }}>
              <Row label="Receive at least">{displayUnits(BigInt(q.minOutputAmount), q.outputToken.decimals, 2, 6)} {q.outputToken.symbol}</Row>
              <Row label="Total fees">{displayUnits(BigInt(q.fees.total.amount), q.fees.total.token.decimals, 2, 6)} {q.fees.total.token.symbol}</Row>
              <Row label="Estimated arrival">{arrival}</Row>
              <Row label="Recipient"><span className="mono break-all text-xs">{recipientAddress}</span></Row>
              <Row label="Contract"><span className="mono text-xs">{shortAddress(q.swapTx.to, 8, 6)}</span></Row>
              <Row label="Steps">{needsApproval ? 'Switch network if needed, approve exact amount, deposit' : 'Switch network if needed, deposit'}</Row>
            </div>
            <p className="mt-3 text-xs" style={{ color: 'var(--warn)' }}>Irreversible. If Across cannot fill the transfer it is refunded to your address on the source chain. Nothing is sent until you confirm in your wallet.</p>
            <TxProgress stage={run.stage} hash={run.hash} error={run.error} walletText={run.note} successText={run.note ?? 'Deposit confirmed'} />
            {run.stage === 'confirming' && run.note && <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>{run.note}</p>}
            {run.stage === 'success' || run.unconfirmed ? (
              // An unconfirmed deposit may still complete, so the only action is to close; retrying could bridge twice.
              <button className="btn btn-primary mt-4 w-full" onClick={() => { setOpen(false); setAmount('') }}>{run.unconfirmed ? 'Close' : 'Done'}</button>
            ) : (
              <button className="btn btn-primary mt-4 w-full" disabled={busy} onClick={() => void confirm(q)}>{busy && <Spinner />} {run.stage === 'error' ? 'Try again' : 'Confirm bridge'}</button>
            )}
          </div>
        )}
      </ConfirmSheet>
    </div>
  )
}
