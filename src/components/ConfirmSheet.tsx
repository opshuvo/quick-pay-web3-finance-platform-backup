import { useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, LazyMotion, m } from 'framer-motion'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** Block dismissing while a transaction is being signed or confirmed. */
  locked?: boolean
}

// Animation features load after the sheet's first use instead of weighing down the first page load.
const loadFeatures = () => import('@/lib/motionFeatures').then((mod) => mod.default)

/** Bottom sheet on mobile, centered dialog on desktop. Used for every financial confirmation. */
export function ConfirmSheet({ open, title, onClose, children, locked }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previous?.focus?.()
    }
  }, [open, locked, onClose])

  return (
    <LazyMotion features={loadFeatures} strict>
    <AnimatePresence>
      {open && (
        <m.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/55 sm:backdrop-blur-sm" onClick={locked ? undefined : onClose} aria-hidden />
          <m.div
            ref={ref}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="card relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-b-none p-5 outline-none sm:rounded-b-3xl"
            style={{ background: 'var(--bg-2)' }}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="display text-lg font-semibold">{title}</h2>
              <button aria-label="Close" disabled={locked} onClick={onClose} className="inline-flex size-10 items-center justify-center rounded-xl disabled:opacity-30" style={{ color: 'var(--muted)' }}>
                <X className="size-5" />
              </button>
            </div>
            {children}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
    </LazyMotion>
  )
}
