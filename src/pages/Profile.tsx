import { useState } from 'react'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { AddressChip, EmptyState, Field, Notice, PageHeader } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { saveProfile, useProfile, validateProfile } from '@/lib/profile'

export default function Profile() {
  const { address, isConnected } = useArcWallet()
  const saved = useProfile(address)
  const [draft, setDraft] = useState<{ displayName: string; username: string } | null>(null)
  const form = draft ?? saved
  const errors = validateProfile(form)
  const invalid = Boolean(errors.displayName || errors.username)

  if (!isConnected || !address) {
    return (
      <div className="mx-auto max-w-lg">
        <PageHeader title="Profile" subtitle="A display name and username for this wallet, saved on this device." />
        <div className="card"><EmptyState title="Connect a wallet" body="Your profile is tied to your wallet address." action={<WalletButton />} /></div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Profile" subtitle="A display name and username for this wallet." />
      <div className="card space-y-4 p-5">
        <div className="flex items-center gap-3">
          <Avatar address={address} label={form.displayName} size={56} />
          <AddressChip address={address} />
        </div>
        <Field label="Display name" error={errors.displayName}>
          <input className="field" maxLength={40} value={form.displayName} onChange={(e) => setDraft({ ...form, displayName: e.target.value })} />
        </Field>
        <Field label="Username" error={errors.username} hint="Lowercase letters, numbers and underscore.">
          <input className="field" maxLength={20} value={form.username} onChange={(e) => setDraft({ ...form, username: e.target.value.toLowerCase() })} />
        </Field>
        <Notice tone="info">Profile details are saved on this device only. They are not a public or on-chain identity.</Notice>
        <button
          className="btn btn-primary w-full"
          disabled={invalid || draft === null}
          onClick={() => {
            saveProfile(address, form)
            setDraft(null)
            toast.success('Profile saved')
          }}
        >
          Save profile
        </button>
      </div>
    </div>
  )
}
