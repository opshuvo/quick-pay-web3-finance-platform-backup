const PALETTES = [
  ['#22d3ee', '#8b5cf6'],
  ['#3b82f6', '#8b5cf6'],
  ['#8b5cf6', '#22d3ee'],
  ['#22d3ee', '#3b82f6'],
  ['#6366f1', '#22d3ee'],
  ['#34f5b5', '#3b82f6'],
]

/** Deterministic gradient avatar derived from the wallet address. No image upload, no tracking. */
export function Avatar({ address, label, size = 36 }: { address?: string; label?: string; size?: number }) {
  const seed = address ? parseInt(address.slice(2, 10), 16) : 0
  const [a, b] = PALETTES[seed % PALETTES.length]
  const angle = (seed >> 3) % 360
  const initial = (label?.trim()[0] ?? address?.[2] ?? '?').toUpperCase()
  return (
    <span
      aria-hidden
      className="display inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `linear-gradient(${angle}deg, ${a}, ${b})`, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.25)' }}
    >
      {initial}
    </span>
  )
}
