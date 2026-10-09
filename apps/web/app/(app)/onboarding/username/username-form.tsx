'use client'

// Choix du username : bloquant, sans design dédié — mêmes tokens que le reste
// de l'app (docs/development.md, anti-patterns : aucun langage visuel neuf).
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { usernameSchema } from '@/lib/username'

import { setUsernameAction } from '../../settings/actions'

export function UsernameForm() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const result = await setUsernameAction(username)

    if (!result.ok) {
      setError(
        result.error === 'taken'
          ? 'That username is already taken.'
          : 'Usernames are 3–20 characters: lowercase letters, numbers, - or _.',
      )
      setSubmitting(false)
      return
    }

    router.push('/collection')
  }

  const isValid = usernameSchema.safeParse(username).success

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-14">
      {error && (
        <div className="rounded-control border border-danger/40 bg-surface-2 px-16 py-12 text-auth-copy text-danger">
          {error}
        </div>
      )}
      <input
        type="text"
        autoComplete="username"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="done"
        required
        autoFocus
        value={username}
        onChange={(event) => setUsername(event.target.value.toLowerCase())}
        placeholder="username"
        aria-label="Username"
        className="w-full rounded-control border border-border bg-surface-1 px-16 py-15 text-auth-input text-text outline-none placeholder:text-text-3"
      />
      <p className="text-body text-text-2">
        3–20 characters: lowercase letters, numbers, - or _.
      </p>
      <button
        type="submit"
        disabled={!isValid || submitting}
        className="w-full rounded-control bg-accent px-16 py-15 text-auth-button font-bold text-on-accent disabled:opacity-60"
      >
        {submitting ? 'Saving...' : 'Continue'}
      </button>
    </form>
  )
}
