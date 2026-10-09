'use client'

// Écran de connexion : sans design dédié — composé exclusivement des tokens et
// du vocabulaire visuel déjà livrés (docs/development.md), au même titre que les
// états de l'onglet Search.
//
// Connexion par lien OU par code (lib/auth-codes/login-code.ts) :
// l'email porte un code à 6 chiffres et un lien. Le lien sert sur l'appareil
// qui lit l'email ; le code se tape ici, sur un autre appareil ou dans la PWA
// installée (un lien d'email s'ouvre toujours dans le navigateur, jamais dans
// l'app).
import { useEffect, useState } from 'react'

import { requestMagicLinkAction } from './actions'

type Status = 'idle' | 'sending' | 'sent' | 'error'

const SEND_FAILED_MESSAGE = "We couldn't send that link. Try again in a moment."
const GENERIC_AUTH_ERROR_MESSAGE = 'Something went wrong signing you in. Try again.'
const WRONG_CODE_MESSAGE = 'That code is wrong or has expired.'
const TOO_MANY_ATTEMPTS_MESSAGE = 'Too many attempts. Request a new code.'
const EXPIRED_LINK_MESSAGE = 'This link is invalid or has expired. Request a new one.'

// Email en cours de connexion, gardé le temps de l'onglet : un code faux
// renvoie Auth.js sur `/login?error=…`, et l'écran doit pouvoir rouvrir la
// saisie du code pour le même email. Confort par onglet seulement (aucune
// préférence de compte) — lectures et écritures protégées, le stockage peut
// être indisponible.
const PENDING_EMAIL_KEY = 'spellcache-login-email'

// Au-delà de la durée de vie d'un code (10 minutes, lib/auth.ts), l'email
// gardé ne rouvre plus la saisie : un retour sur `/login` après une
// déconnexion, dans le même onglet, repart du formulaire vide.
const PENDING_EMAIL_TTL_MS = 10 * 60 * 1000

function readPendingEmail(): string | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_EMAIL_KEY)
    if (!raw) return null
    const separator = raw.indexOf(' ')
    const savedAt = Number(raw.slice(0, separator))
    if (separator === -1 || !(Date.now() - savedAt < PENDING_EMAIL_TTL_MS)) return null
    return raw.slice(separator + 1)
  } catch {
    return null
  }
}

function writePendingEmail(value: string | null) {
  try {
    if (value) window.sessionStorage.setItem(PENDING_EMAIL_KEY, `${Date.now()} ${value}`)
    else window.sessionStorage.removeItem(PENDING_EMAIL_KEY)
  } catch {
    // Stockage indisponible : la saisie du code reste possible tant que
    // l'écran n'est pas rechargé.
  }
}

// `?error=<code>` posé par Auth.js sur redirection vers `pages.error`
// (lib/auth.ts, `pages: { error: '/login' }`) ou par la garde d'essais
// (app/api/auth/[...nextauth]/route.ts, `TooManyAttempts`).
function messageForAuthErrorCode(code: string, withCode: boolean): string {
  if (code === 'TooManyAttempts') return TOO_MANY_ATTEMPTS_MESSAGE
  if (code === 'Verification') return withCode ? WRONG_CODE_MESSAGE : EXPIRED_LINK_MESSAGE
  return GENERIC_AUTH_ERROR_MESSAGE
}

function callbackHref(email: string, code: string): string {
  return `/api/auth/callback/resend?${new URLSearchParams({
    token: code,
    email: email.trim().toLowerCase(),
    callbackUrl: '/onboarding/username',
  })}`
}

export function LoginForm({ initialError }: { initialError?: string }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>(initialError ? 'error' : 'idle')
  const [errorMessage, setErrorMessage] = useState(
    initialError ? messageForAuthErrorCode(initialError, false) : '',
  )
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  // Retour d'un code refusé, ou PWA rechargée par Android pendant que
  // l'utilisateur allait chercher le code dans sa messagerie : on rouvre la
  // saisie pour le même email.
  useEffect(() => {
    const pending = readPendingEmail()
    if (!pending) return
    setEmail(pending)
    setStatus('sent')
    if (initialError) setCodeError(messageForAuthErrorCode(initialError, true))
  }, [initialError])

  // Retour arrière depuis la vérification : la page revient du bfcache avec
  // le bouton figé sur « Signing in... ».
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setVerifying(false)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  async function sendCode() {
    setStatus('sending')
    setCode('')
    setCodeError(null)

    const result = await requestMagicLinkAction(email)
    if (result.ok) {
      writePendingEmail(email.trim().toLowerCase())
      setStatus('sent')
      return
    }

    setErrorMessage(
      result.error === 'invalid_email' ? 'Enter a valid email address.' : SEND_FAILED_MESSAGE,
    )
    setStatus('error')
  }

  function verify(value: string) {
    if (!/^\d{6}$/.test(value)) return
    setVerifying(true)
    window.location.assign(callbackHref(email, value))
  }

  if (status === 'sent') {
    return (
      <div className="flex flex-col items-center gap-8 text-center">
        <div className="text-title-subscreen font-extrabold text-text">Check your inbox</div>
        <p className="text-auth-copy text-text-2">
          We sent a code and a sign-in link to{' '}
          <span className="font-semibold text-text">{email}</span>.
        </p>
        <form
          className="mt-14 flex w-full flex-col gap-14"
          onSubmit={(event) => {
            event.preventDefault()
            verify(code)
          }}
        >
          {codeError && (
            <div className="rounded-control border border-danger/40 bg-surface-2 px-16 py-12 text-auth-copy text-danger">
              {codeError}
            </div>
          )}
          <input
            value={code}
            onChange={(event) => {
              // Chiffres seulement ; le 6e déclenche la vérification.
              const next = event.target.value.replace(/\D/g, '').slice(0, 6)
              setCode(next)
              if (next.length === 6) verify(next)
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            enterKeyHint="go"
            autoFocus
            placeholder="123456"
            aria-label="Sign-in code"
            className="w-full rounded-control border border-border bg-surface-1 px-16 py-15 text-center font-mono text-title-subscreen font-extrabold tracking-title-screen text-text outline-none placeholder:text-text-3"
          />
          <button
            type="submit"
            disabled={verifying || code.length !== 6}
            className="w-full rounded-control bg-accent px-16 py-15 text-auth-button font-bold text-on-accent disabled:opacity-60"
          >
            {verifying ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="mt-8 text-body text-text-2">
          On this device? You can also just open the link in the email.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-x-18">
          <button
            type="button"
            onClick={() => void sendCode()}
            className="py-12 text-button-secondary font-semibold text-accent-text"
          >
            Send a new code
          </button>
          <button
            type="button"
            onClick={() => {
              writePendingEmail(null)
              setCodeError(null)
              setStatus('idle')
            }}
            className="py-12 text-button-secondary font-semibold text-text-2"
          >
            Use a different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void sendCode()
      }}
      className="flex w-full flex-col gap-14"
    >
      {status === 'error' && (
        <div className="rounded-control border border-danger/40 bg-surface-2 px-16 py-12 text-auth-copy text-danger">
          {errorMessage}
        </div>
      )}
      <input
        type="email"
        required
        autoFocus
        autoComplete="email"
        autoCapitalize="none"
        enterKeyHint="send"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        aria-label="Email address"
        className="w-full rounded-control border border-border bg-surface-1 px-16 py-15 text-auth-input text-text outline-none placeholder:text-text-3"
      />
      <button
        type="submit"
        disabled={status === 'sending'}
        className="w-full rounded-control bg-accent px-16 py-15 text-auth-button font-bold text-on-accent disabled:opacity-60"
      >
        {status === 'sending' ? 'Sending...' : 'Send magic link'}
      </button>
    </form>
  )
}
