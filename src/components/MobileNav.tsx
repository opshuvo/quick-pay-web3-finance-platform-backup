import { useState, type PointerEvent } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { PRIMARY_NAV } from '@/nav'

const COUNT = PRIMARY_NAV.length + 1

/** Which tab is selected: a primary page, or "More" when the current page lives there. -1 hides the pill. */
function activeIndex(pathname: string, moreActive: boolean): number {
  const primary = PRIMARY_NAV.findIndex(({ to }) => pathname === to || pathname.startsWith(`${to}/`))
  if (primary >= 0) return primary
  return moreActive ? PRIMARY_NAV.length : -1
}

interface Ripple { key: number; index: number; x: number; y: number }

/**
 * Bottom bar for phones and tablets. Choosing a tab does three things: a soft pill glides to it with a small spring, the
 * icon hops, and a ripple spreads from the exact point you touched. All motion is plain CSS (styles in index.css, .mnav-*),
 * so it adds nothing to the first download and is switched off by the reduced-motion setting.
 */
export function MobileNav({ moreActive, onMore }: { moreActive: boolean; onMore: () => void }) {
  const { pathname } = useLocation()
  const index = activeIndex(pathname, moreActive)
  const [ripple, setRipple] = useState<Ripple | null>(null)

  const touch = (i: number) => (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    setRipple({ key: event.timeStamp, index: i, x: event.clientX - box.left, y: event.clientY - box.top })
  }
  const waves = (i: number) => (ripple?.index === i ? <span key={ripple.key} aria-hidden className="mnav-ripple" style={{ left: ripple.x, top: ripple.y }} onAnimationEnd={() => setRipple(null)} /> : null)

  return (
    <nav aria-label="Primary" className="mnav fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] lg:hidden">
      <div className="relative grid" style={{ gridTemplateColumns: `repeat(${COUNT}, minmax(0, 1fr))` }}>
        <span aria-hidden className="mnav-pill" style={{ width: `${100 / COUNT}%`, transform: `translateX(${Math.max(index, 0) * 100}%)`, opacity: index >= 0 ? 1 : 0 }}>
          <span />
        </span>
        {PRIMARY_NAV.map(({ to, label, short, icon: Icon }, i) => (
          <NavLink key={to} to={to} aria-label={label} className="mnav-item" onPointerDown={touch(i)}>
            {({ isActive }) => (
              <>
                {waves(i)}
                <span className="mnav-icon" data-active={isActive}><Icon className="size-[22px]" aria-hidden /></span>
                <span className="mnav-label" data-active={isActive}>{short ?? label}</span>
              </>
            )}
          </NavLink>
        ))}
        <button type="button" onClick={onMore} onPointerDown={touch(PRIMARY_NAV.length)} aria-label="More pages" className="mnav-item" data-current={moreActive}>
          {waves(PRIMARY_NAV.length)}
          <span className="mnav-icon" data-active={moreActive}><MoreHorizontal className="size-[22px]" aria-hidden /></span>
          <span className="mnav-label" data-active={moreActive}>More</span>
        </button>
      </div>
    </nav>
  )
}
