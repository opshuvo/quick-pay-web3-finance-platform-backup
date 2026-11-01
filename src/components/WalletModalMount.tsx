import { lazy, Suspense, useEffect, useState } from 'react'
import { prefetchAllRoutes } from '@/routes'
import { walletModal } from '@/lib/walletModal'

const WalletModalHost = lazy(() => import('@/components/WalletModalHost'))

/**
 * Loads the wallet picker (about 240 KB compressed, heavy to start) once the screens have been fetched and the browser is idle,
 * or immediately if a wallet button was tapped. It never starts on an ordinary tap, so it cannot slow down navigation.
 */
export function WalletModalMount() {
  const [active, setActive] = useState(walletModal.isRequested())
  useEffect(() => {
    if (active) return
    let cancelled = false
    const go = () => {
      if (!cancelled) setActive(true)
    }
    const connection = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
    // On data saver or 2G the picker loads only when someone taps a wallet button.
    const frugal = Boolean(connection?.saveData) || /(^|-)2g$/.test(connection?.effectiveType ?? '')
    const unsubscribe = walletModal.subscribe(() => walletModal.isRequested() && go())
    let timer: ReturnType<typeof setTimeout> | undefined
    if (!frugal) {
      // Wait for the screens to finish downloading (at most 8 s), then wait for an idle moment.
      void Promise.race([prefetchAllRoutes(), new Promise<void>((resolve) => setTimeout(resolve, 8000))]).then(() => {
        const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
        if (idle) idle(go, { timeout: 4000 })
        else timer = setTimeout(go, 1500)
      })
    }
    return () => {
      cancelled = true
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [active])
  return active ? <Suspense fallback={null}><WalletModalHost /></Suspense> : null
}
