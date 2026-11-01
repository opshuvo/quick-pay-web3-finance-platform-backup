import { useEffect, useState } from 'react'
import { QrCode } from '@/components/QrCode'
import { CopyButton, Skeleton } from '@/components/ui'
import { buildShareLink } from '@/lib/share'

/** Shareable link + QR for a payment request. The link is rebuilt from the id, never stored. */
export function RequestShare({ id }: { id: string }) {
  const [link, setLink] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void buildShareLink(`/pay/${id}`).then((url) => alive && setLink(url))
    return () => {
      alive = false
    }
  }, [id])

  if (!link) return <Skeleton className="h-40" />
  return (
    <div className="flex flex-col items-center gap-3">
      <QrCode value={link} size={168} label="QR code for this payment request link" />
      <div className="inner flex w-full items-center justify-between gap-2 px-3 py-1.5">
        <span className="mono truncate text-xs">{link}</span>
        <CopyButton value={link} label="Copy request link" />
      </div>
      {typeof navigator.share === 'function' && (
        <button className="btn btn-ghost w-full" onClick={() => void navigator.share({ title: 'FlowPay payment request', url: link }).catch(() => undefined)}>
          Share link
        </button>
      )}
    </div>
  )
}
