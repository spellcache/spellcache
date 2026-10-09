// L'échelle d'espacement dynamique de Tailwind est désactivée (`--spacing:
// initial`, docs/development.md) : un pas non déclaré n'émet **aucune**
// classe, silencieusement. Une classe absente du `@theme` ne se voit donc ni
// à la compilation, ni au typecheck, ni au lint — seulement à l'écran.
//
// Ce test compile `app/globals.css` avec le vrai pipeline du projet et
// vérifie que chaque utilitaire de la page publique et des feuilles
// d'import/export/partage produit bien une règle. Il échoue si un token
// consommé par ces écrans disparaît ou n'a jamais existé.
import { describe, expect, it } from 'vitest'

import { compileTailwindCss } from '@/tests/utils/tailwind-css'

// Les utilitaires effectivement écrits par ces écrans, y compris
// ceux repris d'écrans déjà livrés : c'est leur présence dans la feuille
// compilée qui compte, pas leur nouveauté.
const F17_UTILITIES = [
  // Page publique `/s/<id>` — bloc d'en-tête repris de l'écran de binder.
  'pt-binder-title-gap',
  'min-h-binder-backdrop',
  'h-binder-backdrop',
  'h-binder-backdrop-image',
  'bg-gradient-binder-backdrop-art',
  'text-title-binder',
  'tracking-title-binder',
  'text-shadow-binder-title',
  'mt-22',
  'mx-4',
  'text-section-label',
  'tracking-section-label',
  // Feuilles d'import, d'export et de partage.
  'text-meta-mono',
  'text-button-primary',
  'text-status-badge',
  'tracking-status-badge',
  'rounded-control',
  'py-11',
  'py-12',
  'py-13',
  'py-14',
  'px-14',
  'px-16',
  'gap-4',
  'gap-7',
  'gap-8',
  'gap-14',
  'mb-8',
  'mb-14',
  'mb-16',
  'ml-2',
]

describe('utilitaires Tailwind de la page publique et des feuilles', () => {
  it('émet une règle pour chaque utilitaire écrit par la feature', async () => {
    const css = await compileTailwindCss()
    const missing = F17_UTILITIES.filter((utility) => !css.includes(`.${utility} {`))
    expect(missing).toEqual([])
  })

  it('détecte bien une classe qui n’émet rien (garde du garde)', async () => {
    // Un pas non déclaré : la preuve que l'assertion ci-dessus n'est pas
    // vacuellement vraie. `--spacing-19` n'existe pas dans `@theme`, donc
    // `py-19` ne peut pas produire de règle.
    const css = await compileTailwindCss()
    expect(css.includes('.py-19 {')).toBe(false)
  })
})
