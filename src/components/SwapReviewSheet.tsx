import { ConfirmSheet } from '@/components/ConfirmSheet'
import { TxProgress } from '@/components/TxProgress'
import { Notice, Row, Spinner } from '@/components/ui'
import type { ListedToken } from '@/hooks/useTokenList'
import type { SwapQuoteView } from '@/hooks/useSwapQuote'
import type { SwapRun } from '@/hooks/useSwapExecution'
import { arcTxUrl } from '@/lib/arc'
import { displayUnits } from '@/lib/format'
import { formatPercent, formatTokenAmount } from '@/lib/swapAmount'
import type { ApiSwapStep } from '@/lib/uniswap/executeApi'

const STEP_TEXT: Record<ApiSwapStep, string> = {
  quote: 'Re-checking the live quote…',
  approve: 'Approve this exact amount for Permit2 in your wallet…',
  'approve-confirm': 'Waiting for the approval to confirm…',
  permit: 'Sign the Permit2 permission in your wallet…',
  build: 'Building the swap transaction…',
  swap: 'Confirm the swap in your wallet…',
  'swap-confirm': 'Swap submitted. Waiting for on-chain confirmation…',
}

interface Props {
  open: boolean
  onClose: () => void
  view: SwapQuoteView | undefined
  tokenIn: ListedToken | undefined
  tokenOut: ListedToken | undefined
  slippageBps: number
  needsApproval: boolean
  run: SwapRun
  onConfirm: () => void
  onDone: () => void
  onRetrySave: (hash: `0x${string}`) => void
}

export function SwapReviewSheet({ open, onClose, view, tokenIn, tokenOut, slippageBps, needsApproval, run, onConfirm, onDone, onRetrySave }: Props) {
  const busy = run.stage === 'wallet' || run.stage === 'confirming'
  return (
    <ConfirmSheet open={open && Boolean(view)} onClose={onClose} title="Confirm swap" locked={busy}>
      {view && tokenIn && tokenOut && (
        <div>
          <p className="display text-center text-3xl font-bold tabular-nums">{formatTokenAmount(view.amountIn, tokenIn.decimals)} {tokenIn.symbol}</p>
          <p className="my-1 text-center text-sm" style={{ color: 'var(--muted)' }}>for at least</p>
          <p className="display mb-3 text-center text-3xl font-bold tabular-nums">{formatTokenAmount(view.minOut, tokenOut.decimals)} {tokenOut.symbol}</p>
          <div className="inner divide-y px-4" style={{ borderColor: 'var(--border)' }}>
            <Row label="Engine">{view.engine === 'uniswap-api' ? 'Uniswap Trading API' : 'Uniswap pools, direct on-chain'}</Row>
            <Row label="Route">{view.route}</Row>
            <Row label="Expected output">{formatTokenAmount(view.amountOut, tokenOut.decimals)} {tokenOut.symbol}</Row>
            <Row label="Price impact">{formatPercent(view.priceImpactPct)}</Row>
            <Row label="Slippage">{(slippageBps / 100).toFixed(2)}%</Row>
            <Row label="Network fee (est.)">{view.gasUsdc === null ? 'Shown by your wallet' : `≈ ${displayUnits(view.gasUsdc, 6, 4, 6)} USDC`}</Row>
            <Row label="Steps">{needsApproval ? 'Approve exact amount, sign permission, swap' : 'Sign permission, swap'}</Row>
            <Row label="Network">Arc Mainnet</Row>
          </div>
          <p className="mt-3 text-xs" style={{ color: 'var(--warn)' }}>
            Real funds. Nothing is sent until you confirm each step in your wallet. The quote is re-checked first; if the price got worse than what you see here, the swap is not sent.
          </p>
          <TxProgress stage={run.stage} hash={run.hash} error={run.error} txUrl={arcTxUrl} walletText={run.step ? STEP_TEXT[run.step] : 'Confirm in your wallet…'} successText="Swap confirmed on-chain" />
          {run.stage === 'confirming' && run.step && <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>{STEP_TEXT[run.step]}</p>}
          {run.stage === 'success' && (
            <div className="mt-3">
              {run.saved === 'saving' && <Notice tone="info">Saving this swap to your history…</Notice>}
              {run.saved === 'saved' && <Notice tone="success">Saved to your Transaction History as a verified swap.</Notice>}
              {run.saved === 'failed' && run.hash && (
                <Notice tone="warn" action={<button className="btn btn-ghost" onClick={() => onRetrySave(run.hash as `0x${string}`)}>Retry</button>}>
                  The swap succeeded but could not be saved to history yet.
                </Notice>
              )}
            </div>
          )}
          {run.stage === 'success' ? (
            <button className="btn btn-primary mt-4 w-full" onClick={onDone}>Done</button>
          ) : (
            <button className="btn btn-primary mt-4 w-full" disabled={busy} onClick={onConfirm}>
              {busy && <Spinner />} {run.stage === 'error' ? 'Review again and retry' : 'Confirm swap'}
            </button>
          )}
        </div>
      )}
    </ConfirmSheet>
  )
}
