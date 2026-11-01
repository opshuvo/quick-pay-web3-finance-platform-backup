/** Run with: bun run test:render */
import { afterEach, describe, expect, test } from 'bun:test'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useNow } from '../src/hooks/useNow'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
})

function mount(enabled: boolean) {
  const counter = { renders: 0 }
  function Probe() {
    useNow(20, enabled)
    useEffect(() => {
      counter.renders += 1
    })
    return null
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(<Probe />))
  return () => counter.renders
}

describe('useNow', () => {
  test('does not re-render an idle screen', async () => {
    const renders = mount(false)
    const before = renders()
    await act(async () => { await new Promise((r) => setTimeout(r, 120)) })
    expect(renders()).toBe(before)
  })
  test('still ticks while a countdown is on screen', async () => {
    const renders = mount(true)
    const before = renders()
    await act(async () => { await new Promise((r) => setTimeout(r, 120)) })
    expect(renders()).toBeGreaterThan(before)
  })
})
