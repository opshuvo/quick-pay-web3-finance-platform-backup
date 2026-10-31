import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, CameraOff, Keyboard, ScanLine } from 'lucide-react'
import { clsx } from 'clsx'
import { Notice, PageHeader, Spinner } from '@/components/ui'
import { useQrScanner } from '@/hooks/useQrScanner'
import { parsePaymentContent, PaymentParseError, type ParsedPayment } from '@/lib/payments'

type Mode = 'camera' | 'manual'

export default function Scan() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('camera')
  const [manual, setManual] = useState('')
  const [detected, setDetected] = useState<ParsedPayment | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleText = (text: string) => {
    try {
      setDetected(parsePaymentContent(text))
      setError(null)
    } catch (e) {
      setDetected(null)
      setError(e instanceof PaymentParseError ? e.message : 'Could not read that code.')
    }
  }

  const videoRef = useRef<HTMLVideoElement>(null)
  const scanner = useQrScanner(videoRef, handleText)

  // Scanning only fills in details. The user must press Continue, then confirm in the review sheet.
  const proceed = () => {
    if (!detected) return
    if (detected.kind === 'request') void navigate(`/pay/${detected.id}`)
    else void navigate(`/send?to=${detected.to}${detected.amount ? `&amount=${detected.amount}` : ''}&src=scan`)
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Scan & Pay" subtitle="Scan a wallet QR or payment request. Scanning never sends money: it only fills in the details for you to review." />

      <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl p-1" style={{ background: 'var(--surface-muted)' }} role="tablist">
        {([['camera', 'Camera', Camera], ['manual', 'Enter manually', Keyboard]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={mode === id}
            onClick={() => {
              if (id === 'manual') scanner.stop()
              setMode(id)
            }}
            className={clsx('flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-sm font-semibold', mode === id && 'shadow')}
            style={{ background: mode === id ? 'var(--surface-strong)' : 'transparent', color: mode === id ? 'var(--ink)' : 'var(--muted)' }}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      <div className="card p-4">
        {mode === 'camera' ? (
          <div>
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl" style={{ background: 'var(--surface-muted)' }}>
              <video ref={videoRef} muted playsInline className={clsx('size-full object-cover', scanner.state !== 'scanning' && 'hidden')} />
              {scanner.state === 'scanning' && (
                <div className="pointer-events-none absolute inset-8 rounded-3xl border-2" style={{ borderColor: 'var(--accent)' }} aria-hidden />
              )}
              {scanner.state !== 'scanning' && (
                <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center">
                  {scanner.state === 'starting' ? <Spinner className="size-6" /> : scanner.state === 'denied' || scanner.state === 'unavailable' ? <CameraOff className="size-8" style={{ color: 'var(--muted)' }} /> : <ScanLine className="size-8" style={{ color: 'var(--accent)' }} />}
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>
                    {scanner.state === 'denied' && 'Camera permission was blocked. Allow camera access in your browser settings, or enter the address manually.'}
                    {scanner.state === 'unavailable' && 'No usable camera was found on this device or browser. Enter the address manually instead.'}
                    {scanner.state === 'error' && 'The camera could not start. Try again or enter the details manually.'}
                    {scanner.state === 'starting' && 'Starting camera…'}
                    {scanner.state === 'idle' && 'Point your rear camera at a QR code.'}
                  </p>
                </div>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              {scanner.state === 'scanning' ? (
                <button className="btn btn-ghost flex-1" onClick={scanner.stop}>Stop camera</button>
              ) : (
                <button className="btn btn-primary flex-1" disabled={scanner.state === 'starting'} onClick={() => void scanner.start()}>
                  <Camera className="size-4" /> {detected ? 'Scan again' : 'Start camera'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              handleText(manual)
            }}
          >
            <label className="block">
              <span className="label mb-1.5 block">Address, payment link, or request link</span>
              <textarea className="field mono min-h-[96px] resize-none" placeholder="0x… or ethereum:… or a Quick Pay request link" value={manual} onChange={(e) => setManual(e.target.value)} spellCheck={false} />
            </label>
            <button type="submit" className="btn btn-primary w-full" disabled={!manual.trim()}>Check details</button>
          </form>
        )}
      </div>

      {error && <div className="mt-4"><Notice tone="danger">{error}</Notice></div>}

      {detected && (
        <div className="card mt-4 p-5">
          <p className="label">Detected</p>
          {detected.kind === 'address' ? (
            <>
              <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>Recipient</p>
              <p className="mono break-all text-sm font-medium">{detected.to}</p>
              {detected.amount && (
                <>
                  <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>Requested amount</p>
                  <p className="display text-2xl font-bold tabular-nums">{detected.amount} USDC</p>
                </>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm">A Quick Pay payment request (<span className="mono">{detected.id}</span>). Open it to see the amount and who is asking to be paid.</p>
          )}
          <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>Nothing has been sent. Continue to review the payment, then confirm in your wallet.</p>
          <button className="btn btn-primary mt-3 w-full" onClick={proceed}>{detected.kind === 'request' ? 'Open payment request' : 'Continue to review'}</button>
        </div>
      )}
    </div>
  )
}
