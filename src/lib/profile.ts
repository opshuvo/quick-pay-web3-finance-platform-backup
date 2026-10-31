import { useSyncExternalStore } from 'react'

/** Profile details are saved on this device only. They are not a public or on-chain identity. */
export interface Profile {
  displayName: string
  username: string
}

const KEY = 'quickpay.profile.v1'
const EMPTY: Profile = { displayName: '', username: '' }
const listeners = new Set<() => void>()
let version = 0

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/

export function validateProfile(p: Profile): { displayName?: string; username?: string } {
  const errors: { displayName?: string; username?: string } = {}
  if (p.displayName.trim().length > 40) errors.displayName = 'Use 40 characters or fewer.'
  if (/[<>]/.test(p.displayName)) errors.displayName = 'Remove < and > characters.'
  if (p.username && !USERNAME_PATTERN.test(p.username)) errors.username = '3 to 20 characters: lowercase letters, numbers, underscore.'
  return errors
}

function readAll(): Record<string, Profile> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Profile>
  } catch {
    return {}
  }
}

export function loadProfile(address: string | undefined): Profile {
  return (address && readAll()[address.toLowerCase()]) || EMPTY
}

export function saveProfile(address: string, profile: Profile): void {
  const all = readAll()
  all[address.toLowerCase()] = { displayName: profile.displayName.trim(), username: profile.username.trim() }
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* storage unavailable */
  }
  version += 1
  listeners.forEach((l) => l())
}

export function useProfile(address: string | undefined): Profile {
  // Subscribing to a version number keeps the returned object referentially stable between saves.
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version,
    () => 0,
  )
  return loadProfile(address)
}
