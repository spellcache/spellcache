import type { KeyboardEvent } from 'react'

// Attributs communs des champs de recherche par nom de carte ou de set : le
// clavier Android ne corrige ni ne capitalise un nom (« Llanowar » devenait
// « Llanoware »), sa touche Entrée affiche « Rechercher » et referme le
// clavier — la liste filtrée en direct redevient visible en entier.
export const SEARCH_INPUT_PROPS = {
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'none',
  spellCheck: false,
  enterKeyHint: 'search',
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur()
  },
} as const
