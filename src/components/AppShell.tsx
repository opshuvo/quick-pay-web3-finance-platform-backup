import { Suspense, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { DEFAULT_FILTERS, prefetchHistory } from '@/hooks/useHistory'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { prefetchAllRoutes, prefetchRoute } from '@/routes'
import { ChevronDown, ExternalLink, MoreHorizontal, ShieldAlert } from 'lucide-react'
import { clsx } from 'clsx'
import { Avatar } from '@/components/Avatar'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { BackButton } from '@/components/BackButton'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Logo } from '@/components/Logo'
import { MobileNav } from '@/components/MobileNav'
import { NetworkBanner } from '@/components/NetworkBanner'
import { NotificationsMenu } from '@/components/NotificationsMenu'
import { Skeleton } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { ThemeMenu } from '@/components/ThemeMenu'
import { ARC_EXPLORER } from '@/lib/arc'
import { useProfile } from '@/lib/profile'
import { MORE_GROUPS, PRIMARY_NAV } from '@/nav'

function ProfileLink() {
  const { address } = useArcWallet()
  const profile = useProfile(address)
  return (
    <Link to="/profile" aria-label="Profile" className="rounded-full transition-transform hover:scale-105">
      <Avatar address={address} label={profile.displayName} size={40} />
    </Link>
  )
}

const navClass = ({ isActive }: { isActive: boolean }) => clsx('nav-link', isActive && 'active')

/** Pointing at, touching or focusing a navigation link starts loading its screen. */
function prefetchFromEvent(event: { target: EventTarget }) {
  const link = (event.target as Element | null)?.closest?.('a[href^="/"]')
  if (link) prefetchRoute(new URL((link as HTMLAnchorElement).href).pathname)
}

export function AppShell() {
  const [more, setMore] = useState(false)
  const [sidebarMore, setSidebarMore] = useState(false)
  const location = useLocation()
  const wallet = useArcWallet()
  const queryClient = useQueryClient()
  useEffect(() => {
    void prefetchAllRoutes()
  }, [])
  // As soon as a wallet is connected the History, Sent and Received first pages are read in the background, so those screens open already filled.
  useEffect(() => {
    if (!wallet.address) return
    prefetchHistory(queryClient, wallet.address, DEFAULT_FILTERS)
    prefetchHistory(queryClient, wallet.address, { ...DEFAULT_FILTERS, direction: 'out', status: 'confirmed' })
    prefetchHistory(queryClient, wallet.address, { ...DEFAULT_FILTERS, direction: 'in', status: 'confirmed' })
  }, [wallet.address, queryClient])
  const moreActive = MORE_GROUPS.some((g) => g.items.some((i) => (i.to === '/' ? location.pathname === '/' : location.pathname === i.to || location.pathname.startsWith(`${i.to}/`))))
  const sidebarMoreOpen = sidebarMore || moreActive

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[272px_minmax(0,1fr)]" onPointerOver={prefetchFromEvent} onTouchStart={prefetchFromEvent} onFocus={prefetchFromEvent}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:px-4 focus:py-2 focus:text-sm focus:font-semibold" style={{ background: 'var(--accent-btn)', color: 'var(--accent-ink)' }}>Skip to content</a>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-5 border-r px-5 py-5 lg:flex" style={{ borderColor: 'var(--border)', background: 'var(--sidebar)', backdropFilter: 'blur(20px)' }}>
        <Link to="/" aria-label="Quick Pay home" className="px-1"><Logo /></Link>
        <nav aria-label="Main" className="-mr-2 flex flex-1 flex-col gap-5 overflow-y-auto pr-2">
          <div className="flex flex-col gap-0.5 pl-2">
            {PRIMARY_NAV.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={navClass}>
                <Icon className="size-[18px] shrink-0" aria-hidden />
                <span className="truncate">{label}</span>
              </NavLink>
            ))}
          </div>
          <div>
            <button type="button" onClick={() => setSidebarMore((v) => !v)} aria-expanded={sidebarMoreOpen} aria-controls="sidebar-more" className="nav-link w-full">
              <MoreHorizontal className="size-[18px] shrink-0" aria-hidden />
              <span className="flex-1 truncate text-left">More</span>
              <ChevronDown className={clsx('size-4 shrink-0 transition-transform', sidebarMoreOpen && 'rotate-180')} aria-hidden />
            </button>
            {sidebarMoreOpen && (
              <div id="sidebar-more" className="mt-3 flex flex-col gap-4">
                {MORE_GROUPS.map((group) => (
                  <div key={group.title}>
                    <p className="label mb-1.5 px-3">{group.title}</p>
                    <div className="flex flex-col gap-0.5 pl-2">
                      {group.items.map(({ to, label, icon: Icon }) => (
                        <NavLink key={to} to={to} end={to === '/'} className={navClass}>
                          <Icon className="size-[18px] shrink-0" aria-hidden />
                          <span className="truncate">{label}</span>
                        </NavLink>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </nav>
        <div className="inner flex items-start gap-2 p-3 text-xs" style={{ color: 'var(--muted)' }}>
          <ShieldAlert className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--warn)' }} aria-hidden />
          <span>Arc Mainnet moves real USDC. Transactions are irreversible, so check every detail before you confirm.</span>
        </div>
      </aside>

      <div className="min-w-0">
        {/* Header */}
        <header className="app-header sticky top-0 z-30 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-1.5 px-3 py-2 sm:gap-3 sm:px-6 sm:py-2.5">
            <Link to="/" aria-label="Quick Pay home" className="shrink-0 lg:hidden"><Logo compact /></Link>
            <span className="chip ml-auto hidden xl:inline-flex" title="Network">
              <span className="pulse-dot size-1.5 rounded-full" style={{ background: wallet.wrongNetwork ? 'var(--warn)' : 'var(--success)' }} />
              Arc Mainnet · 5042
            </span>
            <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2 lg:ml-0">
              <a href={ARC_EXPLORER} target="_blank" rel="noopener noreferrer" aria-label="Open Arc Explorer in a new tab" className="btn btn-ghost hidden sm:inline-flex !min-h-[44px] !px-3 transition-all duration-200 hover:scale-105 active:scale-95">
                <ExternalLink className="size-4" aria-hidden />
                <span className="hidden md:inline">Explorer</span>
              </a>
              <NotificationsMenu />
              <ThemeMenu />
              <WalletButton />
              <div className="hidden sm:block"><ProfileLink /></div>
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl outline-none px-4 pb-32 pt-5 sm:px-8 sm:pt-8 lg:pb-16">
          <NetworkBanner />
          <BackButton />
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense
              fallback={
                <div className="space-y-4" aria-busy="true">
                  <Skeleton className="h-10 w-56" />
                  <Skeleton className="h-64" />
                </div>
              }
            >
              <div key={location.pathname} className="page-in"><Outlet /></div>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <MobileNav moreActive={moreActive} onMore={() => setMore(true)} />

      <ConfirmSheet open={more} onClose={() => setMore(false)} title="More">
        <div className="space-y-4">
          {MORE_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="label mb-2">{group.title}</p>
              <div className="grid grid-cols-2 gap-2">
                {group.items.map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to} end={to === '/'} onClick={() => setMore(false)} className="inner flex min-h-[52px] items-center gap-2.5 px-3 text-sm font-semibold">
                    <Icon className="size-[18px] shrink-0" style={{ color: 'var(--cyan)' }} aria-hidden />
                    <span className="min-w-0 truncate">{label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <a href={ARC_EXPLORER} target="_blank" rel="noopener noreferrer" className="btn btn-ghost !px-3 text-sm">
              <ExternalLink className="size-4" aria-hidden /> Explorer
            </a>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Theme</span>
              <ThemeMenu />
            </div>
          </div>
        </div>
      </ConfirmSheet>
    </div>
  )
}
