import { TransferExplorer } from '@/components/TransferExplorer'

export default function Sent() {
  return <TransferExplorer lockedTab="out" title="Sent" subtitle="Payments you sent, with status, amount, recipient, time and explorer link." />
}
