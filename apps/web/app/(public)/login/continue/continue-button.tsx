'use client'

// Le geste qui consomme le code : une navigation déclenchée par un clic, que
// les scanners de liens n'exécutent pas.
import { useState } from 'react'

export function ContinueButton({ href }: { href: string }) {
  const [pending, setPending] = useState(false)
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true)
        window.location.assign(href)
      }}
      className="w-full rounded-control bg-accent px-16 py-15 text-auth-button font-bold text-on-accent disabled:opacity-60"
    >
      {pending ? 'Signing in...' : 'Continue to spellcache'}
    </button>
  )
}
