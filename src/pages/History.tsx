import { useSearchParams } from 'react-router-dom'
import { ActivityList } from '@/components/ActivityList'
import { TransferExplorer } from '@/components/TransferExplorer'

export default function History() {
  const [params] = useSearchParams()
  // Re-mount when a global search lands here with a new ?q so the filter is applied.
  return (
    <div className="space-y-6">
      <TransferExplorer key={params.get('q') ?? ''} title="Transaction History" subtitle="USDC activity for your wallet, read from Arc and stored so it follows you across sessions and devices." />
      <ActivityList title="Verified swaps and bridges" />
    </div>
  )
}
