import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ExternalLink, Github, Globe, Wallet } from 'lucide-react'
import { useAccount, useBlockNumber } from 'wagmi'
import { FEATURES, httpsUrl, SECURITY, STEPS, WHY } from '@/components/landing/content'
import { Logo, LogoMark } from '@/components/Logo'
import { OrbitalRings } from '@/components/OrbitalRings'
import { historyServerUsable } from '@/lib/chainHistory/mode'
import { ARC_CHAIN_ID, ARC_EXPLORER, ARC_USDC, arcAddressUrl } from '@/lib/arc'
import { shortAddress } from '@/lib/format'
import { walletModal } from '@/lib/walletModal'
import '@/landing.css'

const YEAR = new Date().getFullYear()
const WEBSITE_URL = 'https://quickpay.boats'
const GITHUB_URL = httpsUrl((import.meta.env.VITE_GITHUB_URL as string | undefined)) ?? 'https://github.com/opshuvo/quick-pay-web3-finance-platform-backup'
const SOCIALS = [
  { label: 'X', href: httpsUrl((import.meta.env.VITE_SOCIAL_X_URL as string | undefined)) ?? 'https://x.com/quickpayxyz' },
  { label: 'Discord', href: httpsUrl((import.meta.env.VITE_SOCIAL_DISCORD_URL as string | undefined)) },
  { label: 'Telegram', href: httpsUrl((import.meta.env.VITE_SOCIAL_TELEGRAM_URL as string | undefined)) },
].filter((s): s is { label: string; href: string } => Boolean(s.href))

function ConnectButton({ size = 'md', label = 'Connect wallet' }: { size?: 'md' | 'lg'; label?: string }) {
  const { status } = useAccount()
  const open = useSyncExternalStore((cb) => walletModal.subscribe(cb), () => walletModal.isOpen(), () => false)
  const busy = open || status === 'connecting'
  return (
    <button type="button" onClick={() => walletModal.request()} className={`ln-btn ln-btn-primary ${size === 'lg' ? 'ln-btn-lg' : ''}`} aria-label="Connect wallet">
      <Wallet className="size-4" aria-hidden />
      {busy ? 'Connecting…' : label}
    </button>
  )
}

/** A real read from Arc, never a made-up figure. It disappears if Arc cannot be reached. */
function LiveArc() {
  const block = useBlockNumber({ chainId: ARC_CHAIN_ID, query: { refetchInterval: 12_000, retry: 1 } })
  const live = block.data !== undefined
  return (
    <div className="ln-live" role="status">
      <span className="ln-dot" data-live={live} aria-hidden />
      <span>{live ? `Live on Arc Mainnet · block ${block.data.toLocaleString('en-US')}` : 'Arc Mainnet'}</span>
    </div>
  )
}

export default function Landing({ exiting = false }: { exiting?: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const server = useQuery({ queryKey: ['landing-server'], queryFn: historyServerUsable, staleTime: 60_000, retry: false })

  // Sections fade up as they scroll into view. Without IntersectionObserver (or with reduced motion) they are simply shown.
  useEffect(() => {
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-reveal]') ?? [])
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      items.forEach((el) => el.setAttribute('data-in', 'true'))
      return
    }
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.setAttribute('data-in', 'true')
          io.unobserve(entry.target)
        }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 })
    items.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <div ref={root} data-theme="dark" className={`ln ${exiting ? 'ln-exit' : 'ln-enter'}`} aria-hidden={exiting || undefined}>
      <a href="#ln-main" className="ln-skip">Skip to content</a>
      <div className="ln-bg" aria-hidden />

      <header className="ln-header">
        <div className="ln-wrap ln-header-row">
          <a href="#top" aria-label="Quick Pay home" className="ln-logo-link"><Logo compact /></a>
          <nav aria-label="Sections" className="ln-nav">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#security">Security</a>
            <a href="#why">Why Quick Pay</a>
          </nav>
          <ConnectButton />
        </div>
      </header>

      <main id="ln-main">
        <section id="top" className="ln-hero" aria-labelledby="ln-h1">
          <OrbitalRings className="ln-orbit" />
          <div className="ln-wrap ln-hero-grid">
            <div className="ln-hero-copy">
              <LiveArc />
              <h1 id="ln-h1" className="ln-h1">USDC payments, <span className="ln-grad">built for Arc</span></h1>
              <p className="ln-lead">Send, receive, split, swap and bridge from your own wallet. Quick Pay never holds your funds, and every payment is checked against Arc before it shows as done.</p>
              <div className="ln-cta-row">
                <ConnectButton size="lg" />
                <a href="#how" className="ln-btn ln-btn-ghost ln-btn-lg">See how it works <ArrowRight className="size-4" aria-hidden /></a>
              </div>
              <p className="ln-trust">Non-custodial · You approve every transaction · Arc Mainnet</p>
            </div>

            <div className="ln-hero-visual" aria-hidden>
              <div className="ln-card ln-float">
                <div className="ln-card-head"><LogoMark size={44} /><div><p className="ln-card-title">Quick Pay</p><p className="ln-card-sub">USDC payments on Arc</p></div></div>
                <dl className="ln-facts">
                  <div><dt>Network</dt><dd>Arc Mainnet</dd></div>
                  <div><dt>Chain ID</dt><dd>{ARC_CHAIN_ID}</dd></div>
                  <div><dt>Gas token</dt><dd>USDC</dd></div>
                  <div><dt>Custody</dt><dd>Your wallet</dd></div>
                </dl>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="ln-section" aria-labelledby="ln-features-h">
          <div className="ln-wrap">
            <p className="ln-eyebrow" data-reveal>Everything in one place</p>
            <h2 id="ln-features-h" className="ln-h2" data-reveal>Pay, split, swap and bridge</h2>
            <ul className="ln-grid ln-grid-4">
              {FEATURES.map((f, i) => (
                <li key={f.title} data-reveal style={{ '--i': i } as React.CSSProperties}>
                  <Link to={f.to} className="ln-card ln-feature">
                    <span className="ln-icon"><f.icon className="size-5" aria-hidden /></span>
                    <h3>{f.title}</h3>
                    <p>{f.text}</p>
                  </Link>
                </li>
              ))}
            </ul>
            {server.data === false && (
              <p className="ln-note" data-reveal>Payment links, splits and saved history use the Quick Pay server, which is not connected on this deployment yet. Sending, receiving, scanning, swapping and bridging work from your wallet.</p>
            )}
          </div>
        </section>

        <section id="how" className="ln-section" aria-labelledby="ln-how-h">
          <div className="ln-wrap">
            <p className="ln-eyebrow" data-reveal>How it works</p>
            <h2 id="ln-how-h" className="ln-h2" data-reveal>Four simple steps</h2>
            <ol className="ln-grid ln-grid-4 ln-steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="ln-card ln-step" data-reveal style={{ '--i': i } as React.CSSProperties}>
                  <span className="ln-step-n" aria-hidden>{i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="security" className="ln-section" aria-labelledby="ln-sec-h">
          <div className="ln-wrap ln-split">
            <div>
              <p className="ln-eyebrow" data-reveal>Security</p>
              <h2 id="ln-sec-h" className="ln-h2" data-reveal>Your funds stay in your wallet</h2>
              <p className="ln-lead" data-reveal>Quick Pay is a front end for your own wallet. It cannot move your funds without your approval, and it shows you what it can verify.</p>
              <div className="ln-card ln-contract" data-reveal>
                <p className="ln-contract-label">USDC on Arc Mainnet</p>
                <a href={arcAddressUrl(ARC_USDC)} target="_blank" rel="noreferrer noopener" className="ln-contract-link mono">{shortAddress(ARC_USDC, 8, 6)} <ExternalLink className="size-3.5" aria-hidden /></a>
                <p className="ln-contract-note">Check the address yourself on the <a href={ARC_EXPLORER} target="_blank" rel="noreferrer noopener">Arc explorer</a>.</p>
              </div>
              <p className="ln-warn" data-reveal>Quick Pay has not had an independent security audit. Arc Mainnet uses real funds, so start with a small amount.</p>
            </div>
            <ul className="ln-points">
              {SECURITY.map((p, i) => (
                <li key={p.title} className="ln-card ln-point" data-reveal style={{ '--i': i } as React.CSSProperties}>
                  <h3>{p.title}</h3>
                  <p>{p.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="why" className="ln-section" aria-labelledby="ln-why-h">
          <div className="ln-wrap">
            <p className="ln-eyebrow" data-reveal>Why Quick Pay</p>
            <h2 id="ln-why-h" className="ln-h2" data-reveal>Built to be simple and honest</h2>
            <ul className="ln-grid ln-grid-3">
              {WHY.map((p, i) => (
                <li key={p.title} className="ln-card ln-point" data-reveal style={{ '--i': i } as React.CSSProperties}>
                  <h3>{p.title}</h3>
                  <p>{p.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="ln-section ln-final" aria-labelledby="ln-final-h">
          <div className="ln-wrap">
            <div className="ln-card ln-final-card" data-reveal>
              <h2 id="ln-final-h" className="ln-h2">Ready to pay on Arc?</h2>
              <p className="ln-lead">Connect your wallet to open your dashboard. Nothing is sent until you approve it.</p>
              <div className="ln-cta-row ln-center"><ConnectButton size="lg" label="Connect wallet to start" /></div>
            </div>
          </div>
        </section>
      </main>

      <footer className="ln-footer">
        <div className="ln-wrap ln-footer-grid">
          <div>
            <Logo compact />
            <p className="ln-footer-note">USDC payments on Arc.</p>
          </div>
          <nav aria-label="Product">
            <h3>Product</h3>
            <ul>
              {FEATURES.slice(0, 5).map((f) => <li key={f.title}><Link to={f.to}>{f.title}</Link></li>)}
              <li><Link to="/swap">Swap</Link></li>
            </ul>
          </nav>
          <nav aria-label="Resources">
            <h3>Resources</h3>
            <ul>
              <li><a href="https://www.circle.com/usdc" target="_blank" rel="noreferrer noopener">About USDC</a></li>
              <li><a href="https://docs.arc.io" target="_blank" rel="noreferrer noopener">Arc documentation</a></li>
              <li><a href={ARC_EXPLORER} target="_blank" rel="noreferrer noopener">Arc explorer</a></li>
            </ul>
          </nav>
          <nav aria-label="Links">
            <h3>Links</h3>
            <ul>
              <li><a href={WEBSITE_URL} target="_blank" rel="noreferrer noopener"><Globe className="size-4" aria-hidden /> quickpay.boats</a></li>
              <li><a href={GITHUB_URL} target="_blank" rel="noreferrer noopener"><Github className="size-4" aria-hidden /> GitHub</a></li>
              {SOCIALS.map((s) => <li key={s.label}><a href={s.href} target="_blank" rel="noreferrer noopener">{s.label}</a></li>)}
            </ul>
          </nav>
        </div>
        <div className="ln-wrap ln-legal">
          <p>© {YEAR} Quick Pay. Quick Pay is software that helps you use your own wallet. It does not hold funds and is not a bank or an exchange. Crypto payments are irreversible.</p>
        </div>
      </footer>
    </div>
  )
}
