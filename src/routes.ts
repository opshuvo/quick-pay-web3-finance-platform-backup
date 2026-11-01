import { lazy, type ComponentType } from 'react'

type Loader = () => Promise<{ default: ComponentType }>

/** One loader per screen. Screens load when first opened, or a moment earlier when the user points at their link. */
export const ROUTE_LOADERS: Record<string, Loader> = {
  '/': () => import('@/pages/Overview'),
  '/payments': () => import('@/pages/Payments'),
  '/send': () => import('@/pages/Send'),
  '/receive': () => import('@/pages/Receive'),
  '/scan': () => import('@/pages/Scan'),
  '/requests': () => import('@/pages/Requests'),
  '/history': () => import('@/pages/History'),
  '/swap': () => import('@/pages/Swap'),
  '/bridge': () => import('@/pages/Bridge'),
  '/analytics': () => import('@/pages/Analytics'),
  '/contracts': () => import('@/pages/Contracts'),
  '/settings': () => import('@/pages/Settings'),
  '/split': () => import('@/pages/Split'),
  '/profile': () => import('@/pages/Profile'),
  '/sent': () => import('@/pages/Sent'),
  '/received': () => import('@/pages/Received'),
}

export const lazyRoute = (path: keyof typeof ROUTE_LOADERS) => lazy(ROUTE_LOADERS[path])

const started = new Set<string>()
/** Starts downloading a screen's code ahead of the click. Skipped on data saver / 2G connections. */
export function prefetchRoute(path: string) {
  const loader = ROUTE_LOADERS[path]
  if (!loader || started.has(path)) return
  const connection = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')) return
  started.add(path)
  void loader().catch(() => started.delete(path))
}

const frugal = () => {
  const connection = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  return Boolean(connection?.saveData) || /(^|-)2g$/.test(connection?.effectiveType ?? '')
}

/** The screens in the bottom bar. They are fetched together, right after the first paint, so none of them ever waits on a download. */
const PRIMARY_ROUTES = ['/send', '/swap', '/bridge', '/receive', '/history']
/** The rest, most used first. Every screen is small, so they are fetched quietly one by one while the browser is idle. */
const PREFETCH_ORDER = ['/scan', '/payments', '/requests', '/sent', '/received', '/analytics', '/split', '/settings', '/contracts', '/profile']

let prefetchAll: Promise<void> | undefined
/**
 * Downloads every screen one at a time while the browser is idle, so that tapping a menu item shows the page at once
 * instead of waiting for its code. Skipped on data saver / 2G. Safe to call repeatedly.
 */
export function prefetchAllRoutes(): Promise<void> {
  prefetchAll ??= (async () => {
    if (frugal()) return
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const pause = () => new Promise<void>((resolve) => (idle ? idle(() => resolve(), { timeout: 800 }) : setTimeout(resolve, 100)))
    await new Promise<void>((resolve) => setTimeout(resolve, 300))
    await Promise.all(PRIMARY_ROUTES.map((path) => { prefetchRoute(path); return ROUTE_LOADERS[path]().catch(() => undefined) }))
    for (const path of PREFETCH_ORDER) {
      await pause()
      prefetchRoute(path)
      await ROUTE_LOADERS[path]().catch(() => undefined)
    }
  })()
  return prefetchAll
}
