'use client'

// Vrai au seul rendu où `value` diffère de celle du rendu précédent (jamais au
// premier). Permet d'ajuster un état local pendant le rendu quand une prop
// change, plutôt que dans un effet qui rendrait une première fois l'état
// périmé : https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
import { useState } from 'react'

export function useChanged<T>(value: T): boolean {
  const [previous, setPrevious] = useState(value)
  if (Object.is(previous, value)) return false
  setPrevious(value)
  return true
}
