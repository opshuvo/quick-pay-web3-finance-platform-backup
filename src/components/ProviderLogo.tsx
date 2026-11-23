export type ProviderId = 'across' | 'lifi' | 'circle'

const FILES: Record<ProviderId, { src: string; name: string }> = {
  across: { src: '/brand/across.svg', name: 'Across' },
  lifi: { src: '/brand/lifi.svg', name: 'LI.FI' },
  circle: { src: '/brand/circle.svg', name: 'Circle' },
}

/** The provider's own published mark, served from this app (no third-party request). */
export function ProviderLogo({ id, size = 24 }: { id: ProviderId; size?: number }) {
  const { src, name } = FILES[id]
  return <img src={src} alt="" aria-hidden width={size} height={size} decoding="async" className="provider-logo" style={{ width: size, height: size }} data-provider={name} />
}
