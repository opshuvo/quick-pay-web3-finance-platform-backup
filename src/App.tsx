import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { AppShell } from '@/components/AppShell'
import { lazyRoute } from '@/routes'

const Landing = lazy(() => import('@/pages/Landing'))
const Overview = lazyRoute('/')
const Payments = lazyRoute('/payments')
const Send = lazyRoute('/send')
const Receive = lazyRoute('/receive')
const Scan = lazyRoute('/scan')
const Requests = lazyRoute('/requests')
const PayRequest = lazy(() => import('@/pages/PayRequest'))
const History = lazyRoute('/history')
const Swap = lazyRoute('/swap')
const Bridge = lazyRoute('/bridge')
const Analytics = lazyRoute('/analytics')
const Contracts = lazyRoute('/contracts')
const Settings = lazyRoute('/settings')
const Split = lazyRoute('/split')
const Payroll = lazyRoute('/payroll')
const SplitDetail = lazy(() => import('@/pages/SplitDetail'))
const Profile = lazyRoute('/profile')
const Sent = lazyRoute('/sent')
const Received = lazyRoute('/received')

/** Shown while the landing page loads: the same dark canvas, so there is no white flash. */
function LandingFallback() {
  return <div data-theme="dark" style={{ minHeight: '100dvh', background: '#030b16' }} aria-busy="true" />
}

/**
 * The home address shows the landing page until a wallet is connected, then the dashboard. Every other address keeps its
 * own behaviour, so shared payment links and deep links still open straight into the app. While a previous wallet session
 * is being restored nothing is drawn, which avoids flashing the landing page at someone who is already connected.
 */
export default function App() {
  const { pathname } = useLocation()
  const { isConnected, status } = useAccount()
  const onHome = pathname === '/'
  const restoring = status === 'reconnecting'
  const showLanding = onHome && !isConnected && !restoring

  // When the wallet connects on the landing page, keep a copy of it fading out above the dashboard.
  const [wasLanding, setWasLanding] = useState(showLanding)
  const [handoff, setHandoff] = useState(false)
  if (wasLanding !== showLanding) {
    setWasLanding(showLanding)
    if (wasLanding && onHome) setHandoff(true)
  }
  useEffect(() => {
    if (!handoff) return
    const timer = setTimeout(() => setHandoff(false), 480)
    return () => clearTimeout(timer)
  }, [handoff])

  if (showLanding) {
    return (
      <Suspense fallback={<LandingFallback />}>
        <Landing />
      </Suspense>
    )
  }
  if (onHome && restoring) return <div style={{ minHeight: '100dvh', background: 'var(--bg)' }} aria-busy="true" />

  return (
    <>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Overview />} />
          <Route path="payments" element={<Payments />} />
          <Route path="send" element={<Send />} />
          <Route path="receive" element={<Receive />} />
          <Route path="scan" element={<Scan />} />
          <Route path="requests" element={<Requests />} />
          <Route path="pay/:id" element={<PayRequest />} />
          <Route path="history" element={<History />} />
          <Route path="swap" element={<Swap />} />
          <Route path="bridge" element={<Bridge />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="contracts" element={<Contracts />} />
          <Route path="settings" element={<Settings />} />
          <Route path="split" element={<Split />} />
          <Route path="payroll" element={<Payroll />} />
          <Route path="split/:id" element={<SplitDetail />} />
          <Route path="profile" element={<Profile />} />
          <Route path="sent" element={<Sent />} />
          <Route path="received" element={<Received />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      {handoff && (
        <Suspense fallback={null}>
          <Landing exiting />
        </Suspense>
      )}
    </>
  )
}
