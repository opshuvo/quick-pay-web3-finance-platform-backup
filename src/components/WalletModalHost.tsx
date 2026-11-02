import { useEffect } from 'react'
import { ConnectKitProvider, useModal } from 'connectkit'
import { useTheme } from '@/hooks/useTheme'
import { walletModal } from '@/lib/walletModal'

const ckTheme = {
  dark: { '--ck-font-family': "'Manrope', sans-serif", '--ck-body-background': '#0a0b1e', '--ck-body-color': '#f3f5ff', '--ck-primary-button-background': '#22e4ff', '--ck-border-radius': '16px' },
  light: { '--ck-font-family': "'Manrope', sans-serif", '--ck-body-background': '#ffffff', '--ck-body-color': '#12143a', '--ck-primary-button-background': '#0597b8', '--ck-border-radius': '16px' },
} as const

/** Opens the wallet picker (connect list when disconnected, profile when connected), exactly like ConnectKit's own button does. */
function Bridge() {
  const { open, setOpen } = useModal()
  useEffect(() => walletModal.register(() => setOpen(true)), [setOpen])
  useEffect(() => walletModal.setOpen(open), [open])
  return null
}

/** The wallet picker. Loaded on demand (see WalletModalMount) because ConnectKit is a large dependency. */
export default function WalletModalHost() {
  const { theme } = useTheme()
  return (
    <ConnectKitProvider mode={theme} customTheme={ckTheme[theme]}>
      <Bridge />
    </ConnectKitProvider>
  )
}
