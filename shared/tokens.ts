/** Tokens Quick Pay can request and send directly on Arc. Both are Circle stablecoins with 6 decimals. */
export type PayToken = 'USDC' | 'EURC'
export const PAY_TOKENS: readonly PayToken[] = ['USDC', 'EURC']
export const PAY_TOKEN_DECIMALS = 6
/** Circle's published EURC contract on Arc Mainnet. A deployment may override it with VITE_EURC_ADDRESS. */
export const EURC_DEFAULT_ADDRESS = '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1'
export const isPayToken = (value: unknown): value is PayToken => value === 'USDC' || value === 'EURC'
