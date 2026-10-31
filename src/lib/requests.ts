import type { RequestDto } from '../../shared/api-types'
import type { SessionToken } from '../../shared/session'
import { api } from '@/lib/api'

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
