import { isHash, type Hex } from 'viem'
import { REQUEST_LIMITS } from '../shared/session'
import type { RequestDto } from '../shared/api-types'

export type { RequestDto }
import { HttpError, requireDb } from './db'
import { config } from './env'
import { client, rpc } from './rpc'
import { rateLimit } from './http'

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const ID_PATTERN = /^[a-z2-9]{16}$/
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'.slice(0, 31)


interface Row {
  id: string
  recipient: string
  amount: string
  description: string
  expires_at: Date | null
  created_at: Date
  status: 'unpaid' | 'paid' | 'cancelled'
  paid_tx_hash: string | null
  paid_by: string | null
  paid_at: Date | null
  cancelled_at: Date | null
}

const COLUMNS = 'id, recipient, amount::text as amount, description, expires_at, created_at, status, paid_tx_hash, paid_by, paid_at, cancelled_at'
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null)

function toDto(r: Row): RequestDto {
  const expired = r.status === 'unpaid' && r.expires_at !== null && new Date(r.expires_at).getTime() < Date.now()
  return {
    id: r.id,
    recipient: r.recipient,
    amount: r.amount,
    description: r.description,
    expiresAt: iso(r.expires_at),
    createdAt: new Date(r.created_at).toISOString(),
    status: expired ? 'expired' : r.status,
    paidTxHash: r.paid_tx_hash,
    paidBy: r.paid_by,
    paidAt: iso(r.paid_at),
    cancelledAt: iso(r.cancelled_at),
    offchain: true,
  }
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

const cleanText = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''

export async function createRequest(recipient: string, body: { amount?: unknown; description?: unknown; expiresAt?: unknown }): Promise<RequestDto> {
  rateLimit(`create:${recipient}`, 30, 60 * 60_000)
  if (typeof body.amount !== 'string' || !/^\d{1,20}$/.test(body.amount)) throw new HttpError(400, 'bad_amount', 'Amount must be a whole number of USDC base units.')
  const amount = BigInt(body.amount)
  if (amount <= 0n || amount > REQUEST_LIMITS.maxAmountRaw) throw new HttpError(400, 'bad_amount', 'Amount is out of range.')
  const description = cleanText(body.description, REQUEST_LIMITS.descriptionMax)
  let expiresAt: Date | null = null
  if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== '') {
    expiresAt = new Date(String(body.expiresAt))
    const ms = expiresAt.getTime()
    if (!Number.isFinite(ms) || ms < Date.now() + 60_000 || ms > Date.now() + 366 * 86_400_000) {
      throw new HttpError(400, 'bad_expiry', 'Expiry must be between one minute and one year from now.')
    }
  }
  const db = requireDb()
  const id = newId()
  const rows = (await db.unsafe(
    `insert into payment_requests (id, recipient, amount, description, expires_at) values ($1, $2, $3, $4, $5) returning ${COLUMNS}`,
    [id, recipient, amount.toString(), description, expiresAt],
  )) as Row[]
  return toDto(rows[0])
}

export async function listRequests(recipient: string): Promise<RequestDto[]> {
  const db = requireDb()
  const rows = (await db.unsafe(`select ${COLUMNS} from payment_requests where recipient = $1 order by created_at desc limit 200`, [recipient])) as Row[]
  return rows.map(toDto)
}

export async function getRequest(id: string): Promise<RequestDto> {
  if (!ID_PATTERN.test(id)) throw new HttpError(404, 'not_found', 'Payment request not found.')
  const db = requireDb()
  const rows = (await db.unsafe(`select ${COLUMNS} from payment_requests where id = $1`, [id])) as Row[]
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Payment request not found.')
  return toDto(rows[0])
}

export async function cancelRequest(id: string, wallet: string): Promise<RequestDto> {
  const existing = await getRequest(id)
  if (existing.recipient !== wallet) throw new HttpError(403, 'forbidden', 'Only the recipient can cancel this request.')
  if (existing.status === 'paid') throw new HttpError(409, 'already_paid', 'This request is already paid.')
  const db = requireDb()
  await db.unsafe(`update payment_requests set status = 'cancelled', cancelled_at = now() where id = $1 and status = 'unpaid'`, [id])
  return getRequest(id)
}

/**
 * Marks a request paid only when the chain proves it: a successful transaction containing a USDC
 * Transfer to the recipient for at least the requested amount, mined after the request was created
 * and before it expired. A transaction can settle at most one request.
 */
export async function verifyPayment(id: string, txHash: unknown, clientKey: string): Promise<RequestDto> {
  rateLimit(`verify:${clientKey}`, 20, 10 * 60_000)
  if (typeof txHash !== 'string' || !isHash(txHash)) throw new HttpError(400, 'bad_hash', 'Enter a valid transaction hash.')
  const request = await getRequest(id)
  if (request.status === 'paid') return request
  if (request.status === 'cancelled') throw new HttpError(409, 'cancelled', 'This request was cancelled.')

  const receipt = await rpc(() => client.getTransactionReceipt({ hash: txHash as Hex })).catch(() => null)
  if (!receipt) throw new HttpError(404, 'tx_not_found', 'Transaction not found on Arc yet. Try again in a few seconds.')
  if (receipt.status !== 'success') throw new HttpError(409, 'tx_failed', 'That transaction failed on-chain.')
  const block = await rpc(() => client.getBlock({ blockNumber: receipt.blockNumber }))
  const minedAt = Number(block.timestamp) * 1000
  if (minedAt < Math.floor(new Date(request.createdAt).getTime() / 1000) * 1000) {
    throw new HttpError(409, 'too_early', 'That payment was made before this request existed.')
  }
  if (request.expiresAt && minedAt > new Date(request.expiresAt).getTime()) {
    throw new HttpError(409, 'expired', 'That payment arrived after the request expired.')
  }
  const needed = BigInt(request.amount)
  const match = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === config.usdc &&
      log.topics[0] === TRANSFER_TOPIC &&
      log.topics.length === 3 &&
      `0x${(log.topics[2] as string).slice(26)}`.toLowerCase() === request.recipient &&
      BigInt(log.data) >= needed,
  )
  if (!match) throw new HttpError(422, 'no_matching_transfer', 'No USDC transfer to the recipient for the requested amount was found in that transaction.')
  const payer = `0x${(match.topics[1] as string).slice(26)}`.toLowerCase()
  const db = requireDb()
  try {
    await db.unsafe(
      `update payment_requests set status = 'paid', paid_tx_hash = $2, paid_by = $3, paid_at = $4 where id = $1 and status = 'unpaid'`,
      [id, txHash.toLowerCase(), payer, new Date(minedAt)],
    )
  } catch {
    throw new HttpError(409, 'tx_already_used', 'That transaction already settled another request.')
  }
  return getRequest(id)
}
