import { useState } from 'react'
import type { Address } from 'viem'
import { Field } from '@/components/ui'
import { useToken } from '@/hooks/useToken'
import { OFFICIAL_ARC_TOKENS } from '@/lib/arcTokens'

const CUSTOM = 'custom'

export const PRESET_TOKENS: { id: string; label: string; address: Address }[] = OFFICIAL_ARC_TOKENS.map(({ id, label, address }) => ({ id, label, address }))

interface Props {
  label: string
  value: string
  onChange: (address: Address | '') => void
}

/** Preset tokens plus any ERC-20 on Arc, validated on-chain (symbol + decimals) before use. */
export function TokenSelect({ label, value, onChange }: Props) {
  const preset = PRESET_TOKENS.find((t) => t.address.toLowerCase() === value.toLowerCase())
  const [custom, setCustom] = useState(!preset && value !== '')
  const [text, setText] = useState(preset ? '' : value)
  const token = useToken(custom ? text : undefined)

  return (
    <div className="space-y-2">
      <select
        aria-label={label}
        className="field"
        value={custom ? CUSTOM : (preset?.id ?? '')}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true)
            onChange((text as Address) || '')
          } else {
            setCustom(false)
            onChange(PRESET_TOKENS.find((t) => t.id === e.target.value)?.address ?? '')
          }
        }}
      >
        <option value="" disabled>Select token</option>
        {PRESET_TOKENS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        <option value={CUSTOM}>Other token (address)…</option>
      </select>
      {custom && (
        <Field label="Token contract on Arc" error={token.invalid ? 'Not a valid ERC-20 on Arc Mainnet.' : null} hint={token.info ? `${token.info.symbol} · ${token.info.decimals} decimals` : 'Paste the token address. Only trade tokens you have verified.'}>
          <input
            className="field mono"
            placeholder="0x…"
            value={text}
            spellCheck={false}
            onChange={(e) => {
              const next = e.target.value.trim()
              setText(next)
              onChange(next as Address)
            }}
          />
        </Field>
      )}
    </div>
  )
}
