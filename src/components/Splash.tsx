import { useEffect, useState } from 'react'
import { LogoMark } from '@/components/Logo'
import { OrbitalRings } from '@/components/OrbitalRings'

const KEY = 'quickpay.splash.v1'
/** The launch animation plays for this long, then fades out. Tapping it skips it. */
const LEAVE_AT_MS = 2700
const GONE_AT_MS = 3200

/** Shown once per browser session. It never blocks the app, which loads underneath it. */
function alreadyShown(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function Splash() {
  const [visible, setVisible] = useState(() => !alreadyShown())
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    try {
      sessionStorage.setItem(KEY, '1')
    } catch {
      /* private mode: the splash simply shows again next visit */
    }
    // With reduced motion the finished frame (mark, name, tagline) is shown straight away and leaves quickly.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const leave = setTimeout(() => setLeaving(true), reduced ? 700 : LEAVE_AT_MS)
    const done = setTimeout(() => setVisible(false), reduced ? 1000 : GONE_AT_MS)
    return () => {
      clearTimeout(leave)
      clearTimeout(done)
    }
  }, [visible])

  if (!visible) return null
  return (
    <div className="splash" data-leaving={leaving} data-testid="splash" role="status" aria-label="Quick Pay is loading" onClick={() => setVisible(false)}>
      <span className="sp-wave sp-wave-1" aria-hidden />
      <span className="sp-wave sp-wave-2" aria-hidden />
      <OrbitalRings />
      <div className="sp-center">
        <div className="sp-logo" aria-hidden>
          <span className="sp-glow" />
          <LogoMark size={104} />
        </div>
        <div className="sp-word">
          <p className="sp-name display">Quick<span>Pay</span></p>
          <p className="sp-tag">USDC payments on Arc</p>
        </div>
      </div>
      <div className="sp-line" aria-hidden><span /></div>
    </div>
  )
}
