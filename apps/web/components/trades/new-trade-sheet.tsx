'use client'

// Nouvel échange : en personne (un nom libre, facultatif) ou avec un compte
// de cette instance qui a activé l'outil. Ouvre l'écran de l'échange créé.
import { Check, UserRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'

import {
  createTradeAction,
  searchTradePartnersAction,
} from '@/app/(app)/tools/trade/actions'
import { SearchField } from '@/components/ui/search-field'
import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'
import { PrimaryButton, SectionLabel } from '@/components/ui/sheet-controls'
import { PARTNER_QUERY_MIN } from '@/lib/trades/partners'
import type { TradePartner } from '@/lib/trades/trades'

type Mode = 'in_person' | 'account'

export function NewTradeSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const inputId = useId()
  const [mode, setMode] = useState<Mode>('in_person')
  const [name, setName] = useState('')
  const [partners, setPartners] = useState<TradePartner[]>([])
  const [query, setQuery] = useState('')
  const [partner, setPartner] = useState<TradePartner | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setMode('in_person')
    setName('')
    setPartners([])
    setQuery('')
    setPartner(null)
    setPending(false)
    setError(null)
  }

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

  async function handleCreate() {
    setPending(true)
    setError(null)
    const result = await createTradeAction(
      mode === 'account' && partner
        ? { counterpartyId: partner.id }
        : { counterpartyName: name },
    )
    if (!result.ok) {
      setError('Could not start this trade. Please try again.')
      setPending(false)
      return
    }
    reset()
    onOpenChange(false)
    router.push(`/tools/trade/${result.tradeId}`)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
      title="New trade"
    >
      <div className="flex flex-col gap-16">
        <Segmented
          options={[
            { value: 'in_person', label: 'In person' },
            { value: 'account', label: 'With a user' },
          ]}
          value={mode}
          onChange={(next) => {
            setMode(next)
            setError(null)
          }}
        />

        {mode === 'in_person' ? (
          <div>
            <label
              htmlFor={inputId}
              className="mb-8 block text-body font-semibold text-text-2"
            >
              Trade partner (optional)
            </label>
            <input
              id={inputId}
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              placeholder="In person"
              className="w-full rounded-control border border-border bg-surface-2 px-12 py-10 text-settings-input text-text outline-none"
            />
            <p className="mt-8 text-meta text-text-3">
              Pick what you give from your collection and what you get from the catalogue.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            <SearchField
              placeholder="Search a username..."
              onSearch={(value) => void handleSearch(value)}
            />
            {query.length >= PARTNER_QUERY_MIN && partners.length === 0 && (
              <p className="px-2 text-meta text-text-2">
                No user found. Only users who turned on Trading mode can be picked.
              </p>
            )}
            {partners.length > 0 && (
              <div>
                <SectionLabel>Users</SectionLabel>
                <div className="flex flex-col gap-8">
                  {partners.map((candidate) => {
                    const selected = partner?.id === candidate.id
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => setPartner(candidate)}
                        aria-pressed={selected}
                        className={`flex items-center gap-12 rounded-row border px-12 py-10 text-left ${
                          selected
                            ? 'border-border-accent bg-accent-bg'
                            : 'border-border bg-surface-1'
                        }`}
                      >
                        <UserRound
                          width={18}
                          height={18}
                          strokeWidth={1.75}
                          className="text-text-2"
                        />
                        <span className="min-w-0 flex-1 truncate text-row-label font-semibold text-text">
                          {candidate.username}
                        </span>
                        {selected && (
                          <Check
                            width={17}
                            height={17}
                            strokeWidth={2}
                            className="text-accent-text"
                          />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <p className="text-meta text-text-3">
              Each of you picks what you give from your own collection. The trade is
              applied to both collections once you have both accepted.
            </p>
          </div>
        )}

        {error && <p className="text-meta text-danger">{error}</p>}

        <PrimaryButton
          onClick={() => void handleCreate()}
          disabled={pending || (mode === 'account' && partner === null)}
        >
          {pending ? 'Working...' : 'Start trade'}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}
