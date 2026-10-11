'use client'

// Icône de set devant une ligne `set · #numéro` — même image et même teinte
// (`icon-set-tint`) que le pied de `GridTile`. L'URL vient toujours de
// `sets.icon_svg_uri` (catalogue), jamais construite. Sans icône, ou si elle
// ne charge pas, rien n'est rendu : le texte de la ligne suffit.
import { useState } from 'react'

export function SetIcon({ uri }: { uri: string | null | undefined }) {
  const [failed, setFailed] = useState(false)
  if (!uri || failed) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element -- icône de set Scryfall, URL lue dans `sets.icon_svg_uri` (catalogue), jamais construite
    <img
      src={uri}
      alt=""
      aria-hidden
      onError={() => setFailed(true)}
      className="icon-set-tint h-icon-set-tile w-icon-set-tile flex-shrink-0"
    />
  )
}
