import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

/** Where Back goes when this page was opened directly (a shared link, a refresh) and there is nothing to go back to. */
function parentOf(pathname: string): string {
  return pathname.startsWith('/split/') ? '/split' : '/'
}

/**
 * Back on every page except the Overview. It returns to the page you came from. If this page was opened directly, so
 * there is no earlier page inside the app, it goes to the page's parent (Overview for most), never out of the app.
 */
export function BackButton() {
  const { pathname, key } = useLocation()
  const navigate = useNavigate()
  if (pathname === '/') return null
  // React Router gives the first page of a session the key "default": nothing earlier in the app to return to.
  const canGoBack = key !== 'default'
  return (
    <div key={pathname} className="back-enter mb-4">
      <button
        type="button"
        onClick={() => {
          if (canGoBack) void navigate(-1)
          else void navigate(parentOf(pathname), { replace: true })
        }}
        aria-label="Go back"
        className="back-btn inline-flex min-h-[44px] items-center gap-2 rounded-xl border py-1 pl-2.5 pr-4 text-sm font-semibold"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink-2)' }}
      >
        <ArrowLeft className="back-arrow size-[18px]" aria-hidden />
        Back
      </button>
    </div>
  )
}
