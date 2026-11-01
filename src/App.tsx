import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { lazyRoute } from '@/routes'

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
const SplitDetail = lazy(() => import('@/pages/SplitDetail'))
const Profile = lazyRoute('/profile')
const Sent = lazyRoute('/sent')
const Received = lazyRoute('/received')

export default function App() {
  return (
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
          <Route path="split/:id" element={<SplitDetail />} />
          <Route path="profile" element={<Profile />} />
          <Route path="sent" element={<Sent />} />
          <Route path="received" element={<Received />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
    </Routes>
  )
}
