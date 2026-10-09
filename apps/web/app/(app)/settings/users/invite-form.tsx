'use client'

// Invitation par email, avec la bascule Admin/Regular user : sans écran
// dédié dans le design — tokens déjà livrés, même vocabulaire que le
// formulaire « Add a member » du groupe Collection › Members de Settings.
import { UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Switch } from '@/components/ui/switch'

import { inviteUserAction } from '../actions'

export function InviteForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [message, setMessage] = useState<{
    kind: 'error' | 'success'
    text: string
  } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setMessage(null)

    const result = await inviteUserAction({ email, isAdmin })

    if (!result.ok) {
      setMessage({
        kind: 'error',
        text:
          result.error === 'exists'
            ? 'An account with that email already exists.'
            : result.error === 'forbidden'
              ? 'You must be an admin to invite accounts.'
              : 'Enter a valid email.',
      })
      setSubmitting(false)
      return
    }

    setEmail('')
    setIsAdmin(false)
    setSubmitting(false)
    setMessage({ kind: 'success', text: 'Invitation sent.' })
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="mb-22">
      <div className="mb-8 flex gap-8">
        <input
          type="email"
          autoCapitalize="none"
          enterKeyHint="send"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          aria-label="Email to invite"
          className="min-w-0 flex-1 rounded-control border border-border bg-surface-1 px-12 py-11 text-body text-text outline-none placeholder:text-text-3"
        />
        <button
          type="submit"
          disabled={submitting}
          className="flex flex-shrink-0 items-center gap-6 rounded-control bg-accent px-16 text-row-value font-bold text-on-accent disabled:opacity-60"
        >
          <UserPlus width={15} height={15} strokeWidth={1.75} />
          Invite
        </button>
      </div>
      <div className="mb-8 flex items-center justify-between gap-12 rounded-control border border-border bg-surface-1 px-14 py-11">
        <span className="text-row-value font-semibold text-text-2">Admin</span>
        <Switch checked={isAdmin} onChange={setIsAdmin} label="Admin" />
      </div>
      {message && (
        <p
          className={
            message.kind === 'error' ? 'text-meta text-danger' : 'text-meta text-success'
          }
        >
          {message.text}
        </p>
      )}
    </form>
  )
}
