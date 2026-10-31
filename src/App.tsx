import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'

const Overview = lazy(() => import('@/pages/Overview'))
const Payments = lazy(() => import('@/pages/Payments'))
const Send = lazy(() => import('@/pages/Send'))
const Receive = lazy(() => import('@/pages/Receive'))
const Scan = lazy(() => import('@/pages/Scan'))
const Requests = lazy(() => import('@/pages/Requests'))
const PayRequest = lazy(() => import('@/pages/PayRequest'))
const History = lazy(() => import('@/pages/History'))
const Swap = lazy(() => import('@/pages/Swap'))
const Bridge = lazy(() => import('@/pages/Bridge'))
const Analytics = lazy(() => import('@/pages/Analytics'))
const Contracts = lazy(() => import('@/pages/Contracts'))
const Settings = lazy(() => import('@/pages/Settings'))
const Split = lazy(() => import('@/pages/Split'))
const SplitDetail = lazy(() => import('@/pages/SplitDetail'))
const Profile = lazy(() => import('@/pages/Profile'))
const Sent = lazy(() => import('@/pages/Sent'))
const Received = lazy(() => import('@/pages/Received'))

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
