import { TransferExplorer } from '@/components/TransferExplorer'

export default function Received() {
  return <TransferExplorer lockedTab="in" title="Received" subtitle="Payments you received, with status, amount, sender, time and explorer link." />
}
