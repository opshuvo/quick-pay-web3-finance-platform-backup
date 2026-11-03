import { afterEach, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Link, MemoryRouter, useLocation } from 'react-router-dom'
import { BackButton } from '../src/components/BackButton'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
})

function Probe() {
  return <p data-testid="path">{useLocation().pathname}</p>
}

async function mount(initial: string[]) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={initial}>
        <BackButton />
        <Probe />
        <Link to="/swap">go swap</Link>
      </MemoryRouter>,
    )
  })
}
const path = () => document.querySelector('[data-testid="path"]')?.textContent
const back = () => document.querySelector('button[aria-label="Go back"]') as HTMLButtonElement | null
const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click() }) }

describe('Back button', () => {
  test('is not shown on the Overview', async () => {
    await mount(['/'])
    expect(back()).toBeNull()
  })
  test('returns to the page you came from', async () => {
    await mount(['/'])
    await click(document.querySelector('a'))
    expect(path()).toBe('/swap')
    expect(back()).not.toBeNull()
    await click(back())
    expect(path()).toBe('/')
    expect(back()).toBeNull()
  })
  test('on a page opened directly it goes to Overview instead of leaving the app', async () => {
    await mount(['/send'])
    await click(back())
    expect(path()).toBe('/')
  })
  test('a split opened directly goes back to the split list', async () => {
    await mount(['/split/abc'])
    await click(back())
    expect(path()).toBe('/split')
  })
})
