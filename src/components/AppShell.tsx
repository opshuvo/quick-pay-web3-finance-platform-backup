import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChevronDown, Moon, MoreHorizontal, Search, ShieldAlert, Sun, X } from 'lucide-react'
import { clsx } from 'clsx'
import { Avatar } from '@/components/Avatar'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { GlobalSearch } from '@/components/GlobalSearch'
import { Logo } from '@/components/Logo'
import { NetworkBanner } from '@/components/NetworkBanner'
import { NotificationsMenu } from '@/components/NotificationsMenu'
import { Skeleton } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { useTheme } from '@/hooks/useTheme'
import { useProfile } from '@/lib/profile'
import { MORE_GROUPS, PRIMARY_NAV } from '@/nav'

function ThemeButton() {
  const { theme, toggle } = useTheme()
  return (
    <button type="button" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} className="btn btn-ghost !min-h-[44px] !px-3">
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  )
}

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

export function AppShell() {
  const [more, setMore] = useState(false)
  const [sidebarMore, setSidebarMore] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const location = useLocation()
  const wallet = useArcWallet()
  const moreActive = MORE_GROUPS.some((g) => g.items.some((i) => (i.to === '/' ? location.pathname === '/' : location.pathname === i.to || location.pathname.startsWith(`${i.to}/`))))
  const sidebarMoreOpen = sidebarMore || moreActive

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-5 border-r px-5 py-5 lg:flex" style={{ borderColor: 'var(--border)', background: 'var(--sidebar)', backdropFilter: 'blur(20px)' }}>
        <Link to="/" aria-label="FlowPay home" className="px-1"><Logo /></Link>
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
        <header className="sticky top-0 z-30 border-b backdrop-blur-xl" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg) 72%, transparent)' }}>
          <div className="flex items-center gap-2 px-4 py-2.5 sm:gap-3 sm:px-6">
            <Link to="/" aria-label="FlowPay home" className="lg:hidden"><Logo compact /></Link>
            <GlobalSearch className="hidden max-w-md flex-1 lg:block" />
            <span className="chip ml-auto hidden xl:inline-flex" title="Network">
              <span className="pulse-dot size-1.5 rounded-full" style={{ background: wallet.wrongNetwork ? 'var(--warn)' : 'var(--success)' }} />
              Arc Mainnet · 5042
            </span>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <button type="button" aria-label={searchOpen ? 'Close search' : 'Search'} onClick={() => setSearchOpen((v) => !v)} className="btn btn-ghost !min-h-[44px] !px-3 lg:hidden">
                {searchOpen ? <X className="size-4" /> : <Search className="size-4" />}
              </button>
              <div className="hidden sm:block"><ThemeButton /></div>
              <NotificationsMenu />
              <WalletButton />
              <div className="hidden sm:block"><ProfileLink /></div>
            </div>
          </div>
          {searchOpen && <div className="px-4 pb-3 lg:hidden"><GlobalSearch /></div>}
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 pb-32 pt-6 sm:px-6 lg:pb-12">
          <NetworkBanner />
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense
              fallback={
                <div className="space-y-4" aria-busy="true">
                  <Skeleton className="h-10 w-56" />
                  <Skeleton className="h-64" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-7 items-end border-t px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg) 90%, transparent)' }}>
        {PRIMARY_NAV.map(({ to, label, short, icon: Icon }) => {
          const center = to === '/scan'
          return (
            <NavLink key={to} to={to} aria-label={label} className="flex min-h-[60px] min-w-0 flex-col items-center justify-center gap-1 text-[10.5px] font-semibold" style={({ isActive }) => ({ color: isActive ? 'var(--cyan)' : 'var(--muted)' })}>
              {center ? (
                <span className="-mt-5 flex size-12 items-center justify-center rounded-2xl text-white" style={{ background: 'linear-gradient(130deg, var(--accent), var(--accent-2))', boxShadow: '0 10px 24px -8px var(--glow), inset 0 1px 0 rgba(255,255,255,.3)' }}>
                  <Icon className="size-5" aria-hidden />
                </span>
              ) : (
                <Icon className="size-5" aria-hidden />
              )}
              <span className="max-w-full truncate">{short ?? label}</span>
            </NavLink>
          )
        })}
        <button type="button" onClick={() => setMore(true)} aria-label="More pages" className="flex min-h-[60px] flex-col items-center justify-center gap-1 text-[10.5px] font-semibold" style={{ color: moreActive ? 'var(--cyan)' : 'var(--muted)' }}>
          <MoreHorizontal className="size-5" aria-hidden />
          More
        </button>
      </nav>

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
          <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <span className="text-sm font-semibold">Theme</span>
            <ThemeButton />
          </div>
        </div>
      </ConfirmSheet>
    </div>
  )
}
