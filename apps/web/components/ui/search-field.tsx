'use client'

// Champ de recherche générique, debounce 200 ms. Un `setTimeout` sans
// nettoyage empile les requêtes à chaque frappe — le
// `useEffect` ci-dessous annule systématiquement le délai précédent avant
// d'en programmer un nouveau.
import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SEARCH_INPUT_PROPS } from '@/components/ui/search-input-props'

const DEFAULT_DEBOUNCE_MS = 200

export function SearchField({
  placeholder,
  onSearch,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  autoFocus,
}: {
  placeholder?: string
  onSearch: (query: string) => void
  debounceMs?: number
  autoFocus?: boolean
}) {
  const [value, setValue] = useState('')
  const onSearchRef = useRef(onSearch)
  onSearchRef.current = onSearch

  useEffect(() => {
    const timeout = setTimeout(() => onSearchRef.current(value), debounceMs)
    return () => clearTimeout(timeout)
  }, [value, debounceMs])

  // Le champ seul, sans marge ni fond de page : la barre collante de
  // l'onglet Search (`sticky top-0 bg-bg px-16 py-10`) vivait ici et
  // repartait avec le composant chez ses autres appelants. Dans la feuille
  // `Add a card` elle ajoutait un second `px-16` par-dessus celui de
  // `Sheet` — champ décalé de 16px par rapport au titre — et peignait le
  // fond de page `bg-bg` au milieu d'une surface `bg-surface-3`. Elle est
  // désormais posée par `search-view.tsx`, le seul écran qui la veut.
  return (
    <div className="flex items-center gap-8 rounded-control bg-surface-1 px-14 py-10">
      <Search
        width={16}
        height={16}
        strokeWidth={1.75}
        className="shrink-0 text-text-3"
      />
      <input
        {...SEARCH_INPUT_PROPS}
        type="search"
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder ?? 'Search'}
        className="w-full bg-transparent text-body text-text outline-none placeholder:text-text-3"
      />
    </div>
  )
}
