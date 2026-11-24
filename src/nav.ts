import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  FileCode2,
  FileText,
  Users,
  History,
  LayoutDashboard,
  Landmark,
  QrCode,
  ScanLine,
  Send,
  Settings,
  SplitSquareHorizontal,
  UserRound,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Short label for the mobile bottom bar. */
  short?: string
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

/** Primary navigation: sidebar and mobile bottom bar. */
export const PRIMARY_NAV: NavItem[] = [
  { to: '/send', label: 'Send', icon: Send },
  { to: '/receive', label: 'Receive', icon: QrCode },
  { to: '/scan', label: 'Scan & Pay', icon: ScanLine, short: 'Scan' },
  { to: '/split', label: 'Split Payment', icon: SplitSquareHorizontal, short: 'Split' },
  { to: '/swap', label: 'Swap', icon: ArrowLeftRight },
  { to: '/bridge', label: 'Bridge', icon: Waypoints },
]

/** Everything else lives under More. Each page appears exactly once across PRIMARY_NAV and MORE_GROUPS. */
export const MORE_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
      { to: '/payments', label: 'Payments', icon: Landmark },
    ],
  },
  {
    title: 'Links & Payroll',
    items: [
      { to: '/requests', label: 'Payment Requests', icon: FileText },
      { to: '/payroll', label: 'Batch Payouts', icon: Users },
    ],
  },
  {
    title: 'Activity',
    items: [
      { to: '/sent', label: 'Sent', icon: ArrowUpRight },
      { to: '/received', label: 'Received', icon: ArrowDownLeft },
      { to: '/history', label: 'Transaction History', icon: History },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/contracts', label: 'Smart Contracts', icon: FileCode2 },
      { to: '/profile', label: 'Profile', icon: UserRound },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

/**
 * The desktop sidebar, grouped by what people are trying to do. Every page is listed once; the mobile bottom bar keeps the
 * six most-used pages and the More sheet holds the rest (MORE_GROUPS).
 */
const byRoute = (routes: string[]): NavItem[] => routes.map((to) => [...PRIMARY_NAV, ...MORE_GROUPS.flatMap((g) => g.items)].find((i) => i.to === to) as NavItem)
export const SIDEBAR_SECTIONS: NavGroup[] = [
  { title: 'Instant Pay', items: byRoute(['/send', '/receive', '/scan']) },
  { title: 'Payment Links', items: byRoute(['/requests', '/payments']) },
  { title: 'Payroll', items: byRoute(['/split', '/payroll']) },
  { title: 'Swap & Bridge', items: byRoute(['/swap', '/bridge']) },
  { title: 'Activity', items: byRoute(['/history', '/sent', '/received', '/analytics']) },
  { title: 'Account', items: byRoute(['/', '/contracts', '/profile', '/settings']) },
]

/** Flat list of every page, once each (used by search). */
export const NAV: NavItem[] = [...PRIMARY_NAV, ...MORE_GROUPS.flatMap((g) => g.items)]
