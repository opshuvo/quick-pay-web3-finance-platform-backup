/** Response shapes shared by the Quick Pay server and the browser. Types only, no runtime code. */
import type { RequestStatus } from './session'

export interface HistoryRow {
  txHash: string
  logIndex: number
  blockNumber: number
  timestamp: string
  from: string
  to: string
  token: string
  amount: string
  direction: 'in' | 'out' | 'self'
  type: 'transfer' | 'request_payment' | 'swap' | 'bridge'
  requestId: string | null
  confirmations: number
  status: 'confirmed'
}

export interface Analytics {
  totalSent: string
  totalReceived: string
  transactionCount: number
  sentCount: number
  receivedCount: number
  firstActivity: string | null
  lastActivity: string | null
  monthly: { month: string; sent: string; received: string; count: number }[]
  breakdown: { type: string; direction: string; count: number; amount: string }[]
  topCounterparties: { address: string; count: number; amount: string }[]
}

export interface Coverage {
  /**
   * unregistered: the wallet is not being indexed yet. indexing: partial history. complete: USDC token
   * Transfer logs scanned from block 0 to near the head (native-value transfers, pending and failed
   * transactions are never covered).
   */
  status: 'unregistered' | 'indexing' | 'complete'
  headBlock: number
  oldestScannedBlock: number | null
  newestScannedBlock: number | null
  blocksRemaining: number
  percent: number
  error: string | null
  rpc: 'proxy' | 'public'
  range: number
  /** True when an unfinished wallet has made no scan progress for longer than the stall threshold. */
  stalled: boolean
  /** Milliseconds since the last scan progress (null once complete or while unregistered). */
  msSinceProgress: number | null
}

export interface RequestDto {
  id: string
  recipient: string
  amount: string
  description: string
  expiresAt: string | null
  createdAt: string
  status: RequestStatus
  paidTxHash: string | null
  paidBy: string | null
  paidAt: string | null
  cancelledAt: string | null
  /** Always true: requests are off-chain records. Only the payment itself is on-chain. */
  offchain: true
}

/** A swap or bridge whose source transaction was read back from its chain. */
export interface ActivityDto {
  id: number
  kind: 'swap' | 'bridge'
  wallet: string
  sourceChainId: number
  destinationChainId: number
  sourceTxHash: string
  destinationTxHash: string | null
  tokenIn: string
  tokenOut: string | null
  /** Display metadata. Swaps: read from the token contracts. Bridges: from the quote (display only). */
  tokenInSymbol: string | null
  tokenInDecimals: number | null
  tokenOutSymbol: string | null
  tokenOutDecimals: number | null
  amountIn: string
  /** Read from the on-chain receipts. Null until the output transfer has been verified. */
  amountOut: string | null
  /** The quote's promised output, for bridges. Never shown as received. */
  expectedAmountOut: string | null
  feeAmount: string | null
  feeToken: string | null
  /** swap: confirmed. bridge: pending until Across reports a fill, then filled; or expired/refunded. */
  status: 'confirmed' | 'pending' | 'filled' | 'expired' | 'refunded'
  /** True only when the destination-chain fill transaction was read back as successful. */
  destinationVerified: boolean
  timestamp: string
  updatedAt: string
}
