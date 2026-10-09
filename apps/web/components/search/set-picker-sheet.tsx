'use client'

// Sélecteur de set dédié, extrait de `SearchFiltersSheet` : titre « Set »,
// champ loupe « Find a set... », ligne « Any set » sélectionnée quand aucun
// set n'est choisi, `aria-pressed` + fond/bordure `selected` sur la ligne
// courante, capé à 60 résultats (la liste complète des ~900 sets de Scryfall
// serait un scroll interminable pour un filtre qui, tapé, la réduit en une
// poignée de lettres), vide « No set under that name. ».
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { SetSummary } from '@/app/(app)/search/actions'
import { Sheet } from '@/components/ui/sheet'
import { SEARCH_INPUT_PROPS } from '@/components/ui/search-input-props'

const MAX_RESULTS = 60

function SetPickerRow({
  label,
  code,
  active,
  onClick,
}: {
  label: string
  code: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center gap-10 rounded-control border px-12 py-11 text-left text-body font-semibold ${
        active
          ? 'border-border-accent bg-accent-bg text-accent-text'
          : 'border-border bg-surface-2 text-text'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {code && <span className="text-meta font-bold text-text-3">{code.toUpperCase()}</span>}
    </button>
  )
}

export function SetPickerSheet({
  open,
  onClose,
  sets,
  value,
  onPick,
}: {
  open: boolean
  onClose: () => void
  sets: SetSummary[]
  value: string | null
  onPick: (code: string | null) => void
}) {
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = needle
      ? sets.filter(
          (set) => set.name.toLowerCase().includes(needle) || set.code.toLowerCase().includes(needle),
        )
      : sets
    return rows.slice(0, MAX_RESULTS)
  }, [sets, query])

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} title="Set" closeLabel="Close set picker">
      <div className="relative mb-12">
        <Search
          width={15}
          height={15}
          strokeWidth={1.75}
          className="pointer-events-none absolute left-11 top-1/2 -translate-y-1/2 text-text-3"
        />
        <input
          {...SEARCH_INPUT_PROPS}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a set..."
          aria-label="Find a set"
          className="w-full rounded-control border border-border bg-surface-2 py-10 pl-32 pr-10 text-meta text-text outline-none placeholder:text-text-3"
        />
      </div>

      <div className="flex flex-col gap-6">
        <SetPickerRow label="Any set" code="" active={!value} onClick={() => onPick(null)} />
        {matches.map((set) => (
          <SetPickerRow
            key={set.code}
            label={set.name}
            code={set.code}
            active={(value ?? '').toLowerCase() === set.code.toLowerCase()}
            onClick={() => onPick(set.code)}
          />
        ))}
        {matches.length === 0 && (
          <div className="px-2 py-6 text-meta text-text-2">No set under that name.</div>
        )}
      </div>
    </Sheet>
  )
}
