import type { RequestDto } from '../../shared/api-types'
import type { SessionToken } from '../../shared/session'
import { api, ApiError, isServiceDown } from '@/lib/api'

export type { RequestDto }

export const requestsApi = {
  create: (token: SessionToken, body: { amount: string; description: string; expiresAt?: string }) =>
    api<RequestDto>('/requests', { method: 'POST', body, token }),
  list: (token: SessionToken) => api<{ requests: RequestDto[] }>('/requests', { token }),
  get: (id: string) => api<RequestDto>(`/requests/${id}`),
  cancel: (token: SessionToken, id: string) => api<RequestDto>(`/requests/${id}/cancel`, { method: 'POST', body: {}, token }),
  verify: (id: string, txHash: string) => api<RequestDto>(`/requests/${id}/verify`, { method: 'POST', body: { txHash } }),
}

export const STATUS_LABEL: Record<RequestDto['status'], string> = {
  unpaid: 'Unpaid',
  paid: 'Paid',
  expired: 'Expired',
  cancelled: 'Cancelled',
}

export const STATUS_TONE: Record<RequestDto['status'], 'success' | 'danger' | 'warn' | 'neutral'> = {
  unpaid: 'warn',
  paid: 'success',
  expired: 'neutral',
  cancelled: 'danger',
}

/**
 * Asks the server to verify a payment, retrying while it cannot see the transaction yet (a different RPC node
 * may lag the one the wallet used) or is briefly unreachable. Definite answers (wrong amount, failed transaction,
 * cancelled request) are never retried.
 */
export async function verifyWithRetry<T>(
  verify: () => Promise<T>,
  { attempts = 5, delayMs = 2_500, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) }: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await verify()
    } catch (error) {
      const retriable = isServiceDown(error) || (error instanceof ApiError && (error.code === 'tx_not_found' || error.code === 'rpc_error'))
      if (!retriable || i >= attempts - 1) throw error
      await sleep(delayMs)
    }
  }
}
