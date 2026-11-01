import { useEffect } from 'react'
import { ConnectKitProvider, useModal } from 'connectkit'
import { useTheme } from '@/hooks/useTheme'
import { walletModal } from '@/lib/walletModal'

const ckTheme = {
  dark: { '--ck-font-family': "'DM Sans', sans-serif", '--ck-body-background': '#0b1430', '--ck-body-color': '#eef2fb', '--ck-primary-button-background': '#6d8cff', '--ck-border-radius': '16px' },
  light: { '--ck-font-family': "'DM Sans', sans-serif", '--ck-body-background': '#ffffff', '--ck-body-color': '#0e1a3a', '--ck-primary-button-background': '#3d5afe', '--ck-border-radius': '16px' },
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
