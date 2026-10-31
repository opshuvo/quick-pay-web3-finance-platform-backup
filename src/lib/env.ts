import { isAddress, type Address } from 'viem'

function addressEnv(value: string | undefined): Address | undefined {
  const trimmed = value?.trim()
  return trimmed && isAddress(trimmed) ? (trimmed) : undefined
}

/** Public, non-secret configuration. Secrets live only on the server. */
export const env = {
  /** Set once the QuickPayRegistry contract is really deployed on Arc Mainnet. */
  registryAddress: addressEnv(import.meta.env.VITE_QUICKPAY_REGISTRY_ADDRESS),
  /** EURC on Arc (public token address), enables the EURC option in Swap. */
  eurcAddress: addressEnv(import.meta.env.VITE_EURC_ADDRESS),
  walletConnectProjectId: (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID)?.trim() || undefined,
}
