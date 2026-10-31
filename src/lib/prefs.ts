import { useSyncExternalStore } from 'react'

/** Device-local preferences. Nothing here is sent to a server. */
export interface Prefs {
  hideBalances: boolean
  notifyIncoming: boolean
}

const KEY = 'quickpay.prefs.v1'
const DEFAULTS: Prefs = { hideBalances: false, notifyIncoming: true }

let cache: Prefs | null = null
const listeners = new Set<() => void>()

function read(): Prefs {
  if (cache) return cache
  try {
    cache = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  cache = { ...read(), [key]: value }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* storage unavailable: preference lasts for this session only */
  }
  listeners.forEach((l) => l())
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    read,
    () => DEFAULTS,
  )
}
