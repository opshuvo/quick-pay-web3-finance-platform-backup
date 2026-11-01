import { useMemo, useState } from 'react'
import { erc20Abi, type Address } from 'viem'
import { usePublicClient, useReadContract, useWalletClient } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowDownUp, RefreshCw, ShieldCheck } from 'lucide-react'
import { ActivityList } from '@/components/ActivityList'
import { AmountInput } from '@/components/AmountInput'
import { SwapReviewSheet } from '@/components/SwapReviewSheet'
import { TokenPicker } from '@/components/TokenPicker'
import { Notice, PageHeader, Row, Skeleton, Spinner, StatusBadge } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { useDebounced } from '@/hooks/useDebounced'
import { useNow } from '@/hooks/useNow'
import { QuoteTimeoutError, QuoteUnavailableError, useSwapQuote } from '@/hooks/useSwapQuote'
import { useSwapExecution } from '@/hooks/useSwapExecution'
import { useTokenList } from '@/hooks/useTokenList'
import { ApiError } from '@/lib/api'
import { ARC_CHAIN_ID, ARC_USDC } from '@/lib/arc'
import { DEFAULT_RECEIVE_TOKEN } from '@/lib/arcTokens'
import { displayUnits } from '@/lib/format'
import { formatPercent, formatRate, formatTokenAmount, parseTokenAmount, type AmountParse } from '@/lib/swapAmount'
import { reviewState } from '@/lib/swapState'
import { checkUniswapDeployment, summarizeDeployment, PERMIT2, PRICE_IMPACT_BLOCK, PRICE_IMPACT_WARN, SLIPPAGE_DEFAULT_BPS, SLIPPAGE_MAX_BPS, SLIPPAGE_WARN_BPS } from '@/lib/uniswap/arc'
import { uniswapApi, type UniswapStatus } from '@/lib/uniswap/api'
import { QUOTE_TTL_MS } from '@/lib/uniswap/apiValidate'

/** USDC is also the gas token on Arc, so MAX keeps a small reserve for network fees. */
const GAS_RESERVE = 20_000n
const UNREACHABLE: UniswapStatus = { configured: false, chainSupported: null, routerVerified: null, protocols: [], message: 'The FlowPay backend is not reachable from here, so the Uniswap Trading API is not used.' }

export default function Swap() {
  const wallet = useArcWallet()
  const publicClient = usePublicClient({ chainId: ARC_CHAIN_ID })
  const { data: walletClient } = useWalletClient({ chainId: ARC_CHAIN_ID })
  const list = useTokenList()
  const [tokenIn, setTokenIn] = useState<string>(ARC_USDC)
  const [tokenOut, setTokenOut] = useState<string>(DEFAULT_RECEIVE_TOKEN)
  const [amount, setAmount] = useState('')
  const [slippageBps, setSlippageBps] = useState(SLIPPAGE_DEFAULT_BPS)
  const [slippageText, setSlippageText] = useState('')
  const [acceptLoss, setAcceptLoss] = useState(false)
  const [open, setOpen] = useState(false)
  const exec = useSwapExecution()
  const now = useNow()

  const inTok = list.tokens.find((t) => t.address.toLowerCase() === tokenIn.toLowerCase())
  const outTok = list.tokens.find((t) => t.address.toLowerCase() === tokenOut.toLowerCase())
  const sameToken = Boolean(tokenIn && tokenOut && tokenIn.toLowerCase() === tokenOut.toLowerCase())

  const statusQuery = useQuery({ queryKey: ['uniswap-status'], staleTime: 60_000, retry: false, queryFn: ({ signal }) => uniswapApi.status(signal) })
  // The status call has a hard timeout; any failure (or a non-status answer) falls back to direct on-chain quotes.
  const validStatus = statusQuery.data && typeof statusQuery.data.configured === 'boolean' ? statusQuery.data : undefined
  const status = validStatus ?? (statusQuery.isError || statusQuery.isSuccess ? UNREACHABLE : undefined)

  const deployment = useQuery({
    queryKey: ['uniswap-deployment'],
    enabled: Boolean(publicClient),
    // A positive answer is trusted for a while; "could not reach Arc" is never cached and is re-checked.
    staleTime: (query) => (summarizeDeployment(query.state.data, false) === 'verified' ? 5 * 60_000 : 0),
    refetchInterval: (query) => (summarizeDeployment(query.state.data, query.state.status === 'error') === 'unreachable' ? 8_000 : false),
    retry: 2,
    queryFn: () => checkUniswapDeployment(publicClient as NonNullable<typeof publicClient>),
  })
  const deploymentState = summarizeDeployment(deployment.data, deployment.isError)
  const deployOk = deploymentState === 'verified'

  const amountParse = useMemo<AmountParse>(
    () => (inTok ? parseTokenAmount(amount, inTok.decimals) : { ok: false, reason: 'empty', message: 'Choose a token.' }),
    [amount, inTok],
  )
  const amountRaw = amountParse.ok ? amountParse.value : undefined
  const amountMessage = amount !== '' && amount !== '.' && !amountParse.ok ? amountParse.message : null
  const debounced = useDebounced(amountRaw, 500)
  const overBalance = amountRaw !== undefined && inTok?.balance !== undefined && amountRaw > inTok.balance
  const quotePending = amountRaw !== undefined && debounced !== amountRaw
  const slippageInvalid = slippageBps > SLIPPAGE_MAX_BPS || slippageBps < 1

  const quote = useSwapQuote({
    tokenIn: inTok?.address,
    tokenOut: outTok?.address,
    amount: debounced,
    slippageBps: Math.min(Math.max(slippageBps, 1), SLIPPAGE_MAX_BPS),
    wallet: wallet.address,
    status,
    enabled: deployOk && wallet.onArc && !sameToken && !overBalance,
  })
  const q = quote.data
  const unavailable = quote.error instanceof QuoteUnavailableError
  const quoteApiError = quote.error instanceof ApiError || quote.error instanceof QuoteTimeoutError ? quote.error.message : null

  const allowance = useReadContract({
    address: tokenIn as Address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: wallet.address ? [wallet.address, PERMIT2] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: Boolean(wallet.address && inTok) },
  })
  const needsApproval = amountRaw !== undefined && (allowance.data ?? 0n) < amountRaw

  const ageMs = q ? now - q.fetchedAt : 0
  const expired = Boolean(q) && ageMs >= QUOTE_TTL_MS && !quote.isFetching
  const secondsLeft = q ? Math.max(0, Math.ceil((QUOTE_TTL_MS - ageMs) / 1000)) : 0
  const impact = q?.priceImpactPct ?? 0
  const highImpact = impact / 100 > PRICE_IMPACT_BLOCK
  const referenceGap = q?.engine === 'uniswap-api' && q.referenceOut && q.referenceOut > 0n ? Number(((q.referenceOut - q.amountOut) * 10_000n) / q.referenceOut) / 10_000 : 0
  const rate = q && inTok && outTok ? formatRate(q.amountOut, outTok.decimals, q.amountIn, inTok.decimals) : undefined
  const payIsGas = Boolean(inTok && inTok.address.toLowerCase() === ARC_USDC.toLowerCase())
  const review = reviewState({
    connected: wallet.isConnected,
    onArc: wallet.onArc,
    signerReady: Boolean(walletClient),
    contractsVerified: deployOk,
    contractsState: deploymentState === 'verified' ? undefined : deploymentState,
    sameToken,
    tokensKnown: Boolean(inTok && outTok),
    amount: amountParse,
    balance: inTok?.balance,
    payIsGasToken: payIsGas,
    gasUsdc: q?.gasUsdc,
    selected: { tokenIn: inTok?.address, tokenOut: outTok?.address, amount: amountRaw },
    quotePending,
    quoteLoading: quote.isFetching && !q,
    quoteServiceChecking: statusQuery.isLoading,
    quote: q,
    quoteError: unavailable ? 'no_route' : quote.isError ? 'failed' : 'none',
    quoteExpired: expired,
    slippageValid: !slippageInvalid,
    highImpact,
    acceptedLoss: acceptLoss,
  })
  const quoteMatchesInput = Boolean(q && amountRaw !== undefined && q.amountIn === amountRaw && inTok && outTok && q.tokenIn.toLowerCase() === inTok.address.toLowerCase() && q.tokenOut.toLowerCase() === outTok.address.toLowerCase())
  const shownQuote = quoteMatchesInput ? q : undefined
  const fetchingQuote = amountRaw !== undefined && !shownQuote && !unavailable && !quote.isError && !overBalance && (quotePending || quote.isFetching)

  function setMax() {
    if (!inTok || inTok.balance === undefined) return
    const usable = inTok.address.toLowerCase() === ARC_USDC.toLowerCase() ? (inTok.balance > GAS_RESERVE ? inTok.balance - GAS_RESERVE : 0n) : inTok.balance
    setAmount(displayUnits(usable, inTok.decimals, 0, inTok.decimals).replace(/,/g, ''))
    setAcceptLoss(false)
  }

  function flip() {
    setTokenIn(tokenOut)
    setTokenOut(tokenIn)
    setAmount('')
    setAcceptLoss(false)
  }

  function applySlippage(text: string) {
    setSlippageText(text)
    const pct = Number(text)
    if (text !== '' && Number.isFinite(pct) && pct >= 0) setSlippageBps(Math.round(pct * 100))
  }

  function confirm() {
    if (!publicClient || !walletClient || !q || !quoteMatchesInput || !inTok || !outTok || !amountRaw) return
    void exec.execute({
      publicClient,
      walletClient,
      reviewed: q,
      refresh: async () => (await quote.refetch()).data,
      tokenIn: inTok.address,
      tokenOut: outTok.address,
      amount: amountRaw,
      slippageBps,
      acceptLoss,
    })
  }

  const after = () => {
    void allowance.refetch()
    void wallet.refetchBalance()
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <PageHeader title="Swap" subtitle="Trade tokens on Arc Mainnet through Uniswap. Quotes, routes and balances are live; nothing is estimated or assumed." />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">Arc Mainnet · 5042</StatusBadge>
          {status ? (
            q?.engine === 'uniswap-api' || (!q && status.configured && status.chainSupported && status.routerVerified) ? (
              <StatusBadge tone="success"><ShieldCheck className="mr-1 inline size-3" aria-hidden />Uniswap Trading API</StatusBadge>
            ) : (
              <StatusBadge tone="warn">Direct on-chain Uniswap</StatusBadge>
            )
          ) : (
            <Skeleton className="h-6 w-32" />
          )}
          {deploymentState === 'verified' && <StatusBadge tone="success">Uniswap contracts verified</StatusBadge>}
          {deploymentState === 'checking' && <StatusBadge tone="neutral"><Spinner /> Verifying contracts…</StatusBadge>}
          {deploymentState === 'unreachable' && <StatusBadge tone="warn">Can't reach Arc to verify</StatusBadge>}
          {deploymentState === 'missing' && <StatusBadge tone="danger">Contracts not found</StatusBadge>}
        </div>
        <Notice tone="warn">Swaps run on <strong>Arc Mainnet with real funds</strong> and cannot be reversed. Only trade tokens whose contract you have verified.</Notice>
        {q?.fallbackReason && <div className="mt-3"><Notice tone="info">Using Uniswap pools directly on-chain. {q.fallbackReason}</Notice></div>}
        {!q && status && !status.configured && <div className="mt-3"><Notice tone="info">Quotes and swaps use Uniswap's pools on Arc directly. The optional Uniswap Trading API is not enabled on this server ({status.message.replace(/\.$/, '')}).</Notice></div>}
        {deploymentState === 'unreachable' && (
          <div className="mt-3"><Notice tone="warn" action={<button className="btn btn-ghost !min-h-[36px]" onClick={() => void deployment.refetch()} disabled={deployment.isFetching}>Retry</button>}>FlowPay could not reach the Arc network to verify the Uniswap contracts (a connection or rate-limit problem, not a missing contract). Swapping stays disabled until they are verified. Retrying automatically.</Notice></div>
        )}
        {deploymentState === 'missing' && <div className="mt-3"><Notice tone="danger">Swapping is disabled. These Uniswap contracts were not found on Arc: {deployment.data?.filter((c) => c.status === 'missing').map((c) => c.name).join(', ')}.</Notice></div>}
        {!list.isLoading && (list.readFailed || list.balanceFailed) && (
          <div className="mt-3"><Notice tone="warn" action={<button className="btn btn-ghost !min-h-[36px]" onClick={() => void list.refetch()} disabled={list.isFetching}>Retry</button>}>{list.tokens.length === 0 ? 'Could not read token details from Arc right now, so no tokens can be selected. This is temporary.' : list.unavailable.length > 0 ? `${list.unavailable.map((u) => u.token.label).join(', ')} could not be verified on Arc right now and cannot be selected until it is.` : 'Some balances could not be read from Arc and are shown as unavailable.'} No values are guessed.</Notice></div>
        )}
      </div>

      <div className="card space-y-3 p-5">
        <div>
          <span className="label mb-1.5 block">You pay</span>
          <TokenPicker label="Pay token" value={tokenIn} tokens={list.tokens} unavailable={list.unavailable} loading={list.isLoading} exclude={tokenOut} onChange={(a) => { setTokenIn(a); setAmount(''); setAcceptLoss(false) }} onAdd={list.add} onRemove={list.remove} />
          <div className="mt-2">
            <AmountInput value={amount} onChange={(v) => { setAmount(v); setAcceptLoss(false) }} symbol={inTok?.symbol ?? ''} balance={inTok?.balance} decimals={inTok?.decimals} balanceLoading={list.isLoading} onMax={inTok?.balance !== undefined ? setMax : undefined} />
          </div>
          {overBalance && <p role="alert" className="mt-1.5 text-xs" style={{ color: 'var(--danger)' }}>Amount is larger than your verified balance.</p>}
          {inTok?.address.toLowerCase() === ARC_USDC.toLowerCase() && <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>USDC is also Arc's gas token. MAX keeps a small reserve for network fees.</p>}
        </div>

        <div className="flex justify-center">
          <button type="button" aria-label="Swap direction" onClick={flip} className="inner flex size-10 items-center justify-center rounded-full transition-transform hover:rotate-180">
            <ArrowDownUp className="size-4" aria-hidden />
          </button>
        </div>

        <div>
          <span className="label mb-1.5 block">You receive (estimated)</span>
          <TokenPicker label="Receive token" value={tokenOut} tokens={list.tokens} unavailable={list.unavailable} loading={list.isLoading} exclude={tokenIn} onChange={(a) => { setTokenOut(a); setAcceptLoss(false) }} onAdd={list.add} onRemove={list.remove} />
          <div className="inner mt-2 p-4">
            <p className="display text-3xl font-bold tabular-nums" aria-live="polite">
              {fetchingQuote ? <Skeleton className="h-9 w-40" /> : shownQuote && outTok ? formatTokenAmount(shownQuote.amountOut, outTok.decimals) : <span style={{ color: 'var(--subtle)' }} title="No live quote yet">—</span>}
              <span className="ml-2 text-base font-semibold" style={{ color: 'var(--subtle)' }}>{outTok?.symbol}</span>
            </p>
            {fetchingQuote && <p className="mt-1 text-xs" role="status" style={{ color: 'var(--muted)' }}>Fetching a live quote…</p>}
          </div>
        </div>

        {sameToken && <Notice tone="danger">Choose two different tokens. On Arc, USDC and the native gas token are one asset, so there is nothing to swap.</Notice>}
        {unavailable && !sameToken && <Notice tone="warn">No route: no live Uniswap pool can fill this pair at this size. Try a different amount or token.</Notice>}
        {shownQuote && shownQuote.amountOut <= 0n && <Notice tone="warn">Amount too small: at this size the swap would pay out nothing. Try a larger amount.</Notice>}
        {quote.isError && !unavailable && !sameToken && <Notice tone="danger" action={<button className="btn btn-ghost !min-h-[36px]" onClick={() => void quote.refetch()}>Retry</button>}>{quoteApiError ?? 'Could not fetch a live quote right now, so no price is shown. Try again in a moment.'}</Notice>}
        {amountMessage && !sameToken && <Notice tone="danger">{amountMessage}</Notice>}
        {payIsGas && review.reason?.startsWith('USDC also pays') && <Notice tone="warn">{review.reason}</Notice>}

        {shownQuote && inTok && outTok && (
          <div className="inner divide-y px-4" style={{ borderColor: 'var(--border)' }}>
            <Row label="Exchange rate">{rate !== undefined ? `1 ${inTok.symbol} ≈ ${rate} ${outTok.symbol}` : '—'}</Row>
            <Row label="Route">{shownQuote.route}</Row>
            <Row label="Price impact"><span style={{ color: impact / 100 > PRICE_IMPACT_WARN ? 'var(--danger)' : undefined }}>{formatPercent(impact)}</span></Row>
            <Row label={`Minimum received (${(slippageBps / 100).toFixed(2)}%)`}>{formatTokenAmount(shownQuote.minOut, outTok.decimals)} {outTok.symbol}</Row>
            <Row label="Network fee (est.)">{shownQuote.gasUsdc === null ? 'Shown by your wallet' : `≈ ${displayUnits(shownQuote.gasUsdc, 6, 4, 6)} USDC`}</Row>
            <Row label="Quote">
              <span className="inline-flex items-center gap-2">
                {expired ? <span style={{ color: 'var(--danger)' }}>Expired</span> : <span className="tabular-nums">Fresh for {secondsLeft}s</span>}
                <button type="button" aria-label="Refresh quote" onClick={() => void quote.refetch()} disabled={quote.isFetching} className="inline-flex size-8 items-center justify-center rounded-lg">
                  <RefreshCw className={`size-4 ${quote.isFetching ? 'animate-spin' : ''}`} aria-hidden />
                </button>
              </span>
            </Row>
          </div>
        )}
        {referenceGap > 0.01 && <Notice tone="warn">The API quote is {(referenceGap * 100).toFixed(1)}% below what Uniswap's pools quote directly on-chain. Review the minimum received carefully.</Notice>}
        {q && impact / 100 > PRICE_IMPACT_WARN && (
          <div className="flex items-start gap-2 text-sm" style={{ color: 'var(--danger)' }} role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>High price impact ({formatPercent(impact)}). Try a smaller amount.</span>
          </div>
        )}
        {highImpact && (
          <label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold">
            <input type="checkbox" className="size-5 accent-[var(--danger)]" checked={acceptLoss} onChange={(e) => setAcceptLoss(e.target.checked)} />
            I accept a loss of about {impact.toFixed(1)}%
          </label>
        )}

        <details>
          <summary className="min-h-[36px] cursor-pointer text-sm font-semibold">Slippage tolerance: {(slippageBps / 100).toFixed(2)}%</summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {[10, 50, 100].map((bps) => (
              <button key={bps} className="chip min-h-[36px]" aria-pressed={slippageBps === bps} style={slippageBps === bps ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined} onClick={() => { setSlippageBps(bps); setSlippageText('') }}>{bps / 100}%</button>
            ))}
            <input aria-label="Custom slippage percent" className="field !min-h-[36px] !w-24" inputMode="decimal" placeholder="Custom %" value={slippageText} onChange={(e) => /^\d*\.?\d{0,2}$/.test(e.target.value) && applySlippage(e.target.value)} />
          </div>
          {slippageInvalid && <p role="alert" className="mt-1.5 text-xs" style={{ color: 'var(--danger)' }}>Slippage must be between 0.01% and {SLIPPAGE_MAX_BPS / 100}%.</p>}
          {!slippageInvalid && slippageBps > SLIPPAGE_WARN_BPS && <p className="mt-1.5 text-xs" style={{ color: 'var(--warn)' }}>Higher slippage can mean a worse price.</p>}
        </details>

        {!wallet.isConnected ? (
          <WalletButton className="w-full" />
        ) : !wallet.onArc ? (
          <button className="btn btn-primary w-full" onClick={() => void wallet.switchToArc()}>Switch to Arc Mainnet</button>
        ) : (
          <>
            <button className="btn btn-primary w-full" disabled={!review.canReview} aria-describedby="review-reason" onClick={() => { exec.reset(); setOpen(true) }}>
              {fetchingQuote ? <Spinner /> : null} {review.label}
            </button>
            {review.reason && !review.canReview && <p id="review-reason" role="status" className="text-center text-xs" style={{ color: 'var(--muted)' }}>{review.reason}</p>}
          </>
        )}
      </div>

      <ActivityList kind="swap" title="Your swaps" />

      <SwapReviewSheet
        open={open}
        onClose={() => setOpen(false)}
        view={shownQuote}
        tokenIn={inTok}
        tokenOut={outTok}
        slippageBps={slippageBps}
        needsApproval={needsApproval}
        run={exec.run}
        onConfirm={confirm}
        onDone={() => { setOpen(false); setAmount(''); after() }}
        onRetrySave={(hash) => void exec.retrySave(hash)}
      />
    </div>
  )
}
