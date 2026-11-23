import { useEffect, useState } from 'react'
import { LogoMark } from '@/components/Logo'

const KEY = 'quickpay.splash.v1'
const SHOW_MS = 1500

/** Shown once per browser session. Tapping it skips it; it never blocks the app, which loads underneath. */
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
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const leave = setTimeout(() => setLeaving(true), reduced ? 400 : 1050)
    const done = setTimeout(() => setVisible(false), reduced ? 700 : SHOW_MS)
    return () => {
      clearTimeout(leave)
      clearTimeout(done)
    }
  }, [visible])

  if (!visible) return null
  return (
    <div className="splash" data-leaving={leaving} role="status" aria-label="Quick Pay is loading" onClick={() => setVisible(false)}>
      <div className="splash-stage" aria-hidden>
                <span className="splash-logo"><LogoMark size={84} /></span>
      </div>
      <div className="splash-word text-center">
        <p className="display text-3xl font-bold tracking-tight">Quick<span className="gradient-text">Pay</span></p>
        <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--muted)' }}>USDC payments on Arc</p>
      </div>
      <div className="splash-bar" aria-hidden><span /></div>
    </div>
  )
}
