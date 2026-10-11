'use client'

// Étape 1 : en personne (un nom libre, facultatif) ou avec un compte de cette
// instance qui a activé l'outil. Valider crée l'échange et ouvre l'étape des
// cartes.
import { Check, Handshake, UserRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'

import { createTradeAction, searchTradePartnersAction } from '@/app/(app)/tools/trade/actions'
import { WizardHeader } from '@/components/trades/wizard-header'
import { Screen } from '@/components/ui/screen'
import { SearchField } from '@/components/ui/search-field'
import { PrimaryButton } from '@/components/ui/sheet-controls'
import { PARTNER_QUERY_MIN } from '@/lib/trades/partners'
import type { TradePartner } from '@/lib/trades/trades'

type Mode = 'in_person' | 'account'

function ChoiceCard({
  selected,
  onClick,
  icon,
  title,
  subtitle,
}: {
  selected: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  subtitle: string
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex w-full items-center gap-14 rounded-row border p-16 text-left ${
        selected ? 'border-border-accent bg-accent-bg' : 'border-border bg-surface-1'
      }`}
    >
      <span
        className={`flex h-touch-target w-touch-target flex-shrink-0 items-center justify-center rounded-control ${
          selected ? 'bg-accent text-on-accent' : 'bg-surface-2 text-text-2'
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-row-label font-bold text-text">{title}</span>
        <span className="mt-2 block text-meta text-text-2">{subtitle}</span>
      </span>
    </button>
  )
}

export function WhoStep() {
  const router = useRouter()
  const nameId = useId()
  const [mode, setMode] = useState<Mode>('in_person')
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [partners, setPartners] = useState<TradePartner[]>([])
  const [partner, setPartner] = useState<TradePartner | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSearch(value: string) {
    const trimmed = value.trim()
    setQuery(trimmed)
    if (trimmed.length < PARTNER_QUERY_MIN) {
      setPartners([])
      return
    }
    const result = await searchTradePartnersAction({ query: trimmed })
    setPartners(result.ok ? result.partners : [])
  }

  async function handleNext() {
    setPending(true)
    setError(null)
    const result = await createTradeAction(
      mode === 'account' && partner ? { counterpartyId: partner.id } : { counterpartyName: name },
    )
    if (!result.ok) {
      setError('Could not start this trade. Please try again.')
      setPending(false)
      return
    }
    router.push(`/tools/trade/${result.tradeId}?step=cards`)
  }

  return (
    <Screen
      header={
        <WizardHeader
          step={1}
          total={mode === 'in_person' ? 4 : 2}
          title="Who are you trading with?"
          closeHref="/tools/trade"
        />
      }
    >
      <div className="flex flex-col gap-10" role="group" aria-label="Who are you trading with?">
        <ChoiceCard
          selected={mode === 'in_person'}
          onClick={() => setMode('in_person')}
          icon={<Handshake width={22} height={22} strokeWidth={1.75} />}
          title="In person"
          subtitle="You enter both sides."
        />
        <ChoiceCard
          selected={mode === 'account'}
          onClick={() => setMode('account')}
          icon={<UserRound width={22} height={22} strokeWidth={1.75} />}
          title="A user of spellcache"
          subtitle="Live, on this server."
        />
      </div>

      <div className="mt-22">
        {mode === 'in_person' ? (
          <div>
            <label htmlFor={nameId} className="mb-8 block text-body font-semibold text-text-2">
              Their name (optional)
            </label>
            <input
              id={nameId}
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Sam at the LGS"
              className="w-full rounded-control border border-border bg-surface-1 px-12 py-12 text-settings-input text-text outline-none"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            <SearchField placeholder="Search a username..." onSearch={(value) => void handleSearch(value)} />
            {query.length >= PARTNER_QUERY_MIN && partners.length === 0 && (
              <p className="px-2 text-meta text-text-2">
                No user found. Only users who turned on Trading mode can be picked.
              </p>
            )}
            {partners.map((candidate) => {
              const selected = partner?.id === candidate.id
              return (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => setPartner(candidate)}
                  aria-pressed={selected}
                  className={`flex items-center gap-12 rounded-control border px-12 py-11 text-left ${
                    selected ? 'border-border-accent bg-accent-bg' : 'border-border bg-surface-1'
                  }`}
                >
                  <UserRound width={18} height={18} strokeWidth={1.75} className="text-text-2" />
                  <span className="min-w-0 flex-1 truncate text-row-label font-semibold text-text">
                    {candidate.username}
                  </span>
                  {selected && <Check width={17} height={17} strokeWidth={2} className="text-accent-text" />}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {error && <p className="mt-14 text-meta text-danger">{error}</p>}

      <div className="mt-24">
        <PrimaryButton
          onClick={() => void handleNext()}
          disabled={pending || (mode === 'account' && partner === null)}
        >
          {pending ? 'Working...' : 'Next: your cards'}
        </PrimaryButton>
      </div>
    </Screen>
  )
}
