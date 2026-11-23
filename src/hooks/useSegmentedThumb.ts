import { useEffect } from 'react'

const SELECTED = '[aria-selected="true"], [aria-pressed="true"]'

function place(el: HTMLElement) {
  const selected = el.querySelector<HTMLElement>(SELECTED)
  if (!selected || selected.offsetWidth === 0) {
    delete el.dataset.thumb
    return
  }
  el.style.setProperty('--thumb-x', `${selected.offsetLeft}px`)
  el.style.setProperty('--thumb-w', `${selected.offsetWidth}px`)
  if (!el.dataset.thumb) {
    // Position first, then allow the glide, so the pill never slides in from the left on first paint.
    el.dataset.thumb = 'on'
    requestAnimationFrame(() => requestAnimationFrame(() => { el.dataset.glide = 'on' }))
  }
}

/**
 * Gives every segmented control (`.segmented`) a pill that glides to the selected option.
 * It only reads the controls' existing aria state, so no screen needs to change.
 */
export function useSegmentedThumb() {
  useEffect(() => {
    const controls = new Set<HTMLElement>()
    const resize = new ResizeObserver((entries) => entries.forEach((e) => place(e.target as HTMLElement)))
    const scan = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>('.segmented').forEach((el) => {
        if (!controls.has(el)) {
          controls.add(el)
          resize.observe(el)
        }
        place(el)
      })
    }
    scan(document)
    const mutations = new MutationObserver((records) => {
      let rescan = false
      for (const r of records) {
        if (r.type === 'attributes') {
          const el = (r.target as HTMLElement).closest<HTMLElement>('.segmented')
          if (el) place(el)
        } else if (r.addedNodes.length > 0) rescan = true
      }
      if (rescan) scan(document)
      controls.forEach((el) => { if (!el.isConnected) { controls.delete(el); resize.unobserve(el) } })
    })
    mutations.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'aria-pressed'] })
    return () => { mutations.disconnect(); resize.disconnect() }
  }, [])
}
