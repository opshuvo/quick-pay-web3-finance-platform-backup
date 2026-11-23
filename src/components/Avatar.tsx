const PALETTES = ['#2f5bd8', '#0f766e', '#6048b8', '#a2510b', '#475569', '#0b6b86']

/** Deterministic flat avatar derived from the wallet address. No image upload, no tracking. */
export function Avatar({ address, label, size = 36 }: { address?: string; label?: string; size?: number }) {
  const seed = address ? parseInt(address.slice(2, 10), 16) : 0
  const color = PALETTES[seed % PALETTES.length]
  const initial = (label?.trim()[0] ?? address?.[2] ?? '?').toUpperCase()
  return (
    <span
      aria-hidden
      className="display inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4, background: color }}
    >
      {initial}
    </span>
  )
}
