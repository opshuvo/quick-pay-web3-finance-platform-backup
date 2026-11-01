/**
 * Connects the wallet buttons (always loaded, tiny) to the wallet picker (ConnectKit, loaded on demand).
 * A click before the picker has loaded is remembered and opens it the moment it is ready.
 */
type Listener = () => void

let opener: (() => void) | undefined
let pending = false
let open = false
const listeners = new Set<Listener>()
const emit = () => listeners.forEach((l) => l())

export const walletModal = {
  /** Asks for the picker. Opens it now if loaded, otherwise as soon as it loads. */
  request() {
    if (opener) {
      opener()
      return
    }
    pending = true
    emit()
  },
  register(fn: () => void) {
    opener = fn
    if (pending) {
      pending = false
      // Let the picker finish mounting first: its provider resets its own state during mount and would undo an immediate open.
      setTimeout(() => opener?.(), 0)
    }
    return () => {
      if (opener === fn) opener = undefined
    }
  },
  setOpen(value: boolean) {
    if (open === value) return
    open = value
    emit()
  },
  isOpen: () => open,
  isRequested: () => pending || opener !== undefined,
  subscribe(fn: Listener) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}
