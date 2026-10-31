/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_QUICKPAY_REGISTRY_ADDRESS?: string
  readonly VITE_EURC_ADDRESS?: string
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
