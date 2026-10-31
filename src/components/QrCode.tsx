import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Skeleton } from '@/components/ui'

/** Renders `value` as a QR code. Always black on white so every scanner can read it. */
export function QrCode({ value, size = 232, label }: { value: string; size?: number; label: string }) {
  const [result, setResult] = useState<{ key: string; src?: string; failed?: boolean } | null>(null)
  const key = `${value}|${size}`

  useEffect(() => {
    let alive = true
    QRCode.toDataURL(value, { width: size * 2, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0b1430', light: '#ffffff' } })
      .then((src) => alive && setResult({ key, src }))
      .catch(() => alive && setResult({ key, failed: true }))
    return () => {
      alive = false
    }
  }, [value, size, key])

  const current = result?.key === key ? result : null
  if (current?.failed) return <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>Could not generate the QR code.</p>
  if (!current?.src) return <Skeleton className="rounded-2xl" />
  return <img src={current.src} alt={label} width={size} height={size} className="rounded-2xl bg-white" style={{ width: size, height: size }} />
}
