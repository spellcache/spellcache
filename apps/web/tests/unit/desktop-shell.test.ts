// Résolution de l'entrée active de la barre latérale (`Sidebar({ tree,
// activeId })`) et media query partagée. Deux
// fonctions pures, testées sans DOM — le reste de la coquille desktop est
// mesuré dans Chromium par `tests/unit/row-heights.test.tsx`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

import { activeIdFromPathname } from '@/app/(app)/app-shell'
import { BREAKPOINTS, minWidthQuery } from '@/lib/breakpoints'

describe('activeIdFromPathname', () => {
  it('names a section by its key, the same string as a mobile tab', () => {
    expect(activeIdFromPathname('/collection')).toBe('collection')
    expect(activeIdFromPathname('/search')).toBe('search')
    expect(activeIdFromPathname('/decks')).toBe('decks')
    expect(activeIdFromPathname('/tools')).toBe('tools')
    expect(activeIdFromPathname('/settings')).toBe('settings')
  })

  it('names a container and a deck folder by their id', () => {
    expect(activeIdFromPathname('/container/abc-123')).toBe('abc-123')
    expect(activeIdFromPathname('/decks/folders/f-9')).toBe('f-9')
  })

  it('keeps a single deck under the Decks entry, not under a folder', () => {
    // `/decks/[id]` n'est pas un dossier : sans cette distinction, ouvrir un
    // deck viderait la surbrillance de l'entrée `Decks` de la barre.
    expect(activeIdFromPathname('/decks/deck-1')).toBe('decks')
  })

  it('falls back to the collection at the root', () => {
    expect(activeIdFromPathname('/')).toBe('collection')
  })
})

describe('minWidthQuery', () => {
  it('builds the query from BREAKPOINTS, never from a literal', () => {
    expect(minWidthQuery(BREAKPOINTS.mobile)).toBe('(min-width: 900px)')
    expect(minWidthQuery(BREAKPOINTS.previewPane)).toBe('(min-width: 1280px)')
  })
})

// Régression du layout desktop : au-delà de 768px, `BinderHeader` est masqué et
// `MainHeader` prend le relais. Si `LookSheet`, `ShareSheet` et
// `ListExportSheet` étaient montées **dans** `BinderHeader`, un binder
// perdrait sur desktop son apparence, son renommage, sa suppression, son
// partage public et son export.
//
// Sans pour autant en produire une seconde implémentation desktop : ce test
// vérifie qu'il n'existe qu'un seul point de montage de ces trois
// feuilles pour un container (`container-action-sheets.tsx`, ouvert aussi bien
// par le `···` de `BinderHeader` que par celui de `MainHeader`), l'écran de
// deck gardant le sien.
// Le recensement des écrans autorisés à monter chacune de ces feuilles.
//
// L'invariant n'est pas « deux fichiers » : c'est qu'aucun écran n'en fasse
// pousser une seconde copie. La liste est donc une liste, pas un compte — y
// ajouter une entrée est un geste délibéré, et c'est précisément ce que ce
// test force à faire quand un écran gagne l'une de ces actions.
//
// `ListExportSheet` ne reste montée que par l'écran de deck et le menu de
// binder/liste — l'accueil de la collection et le container racine
// sont passés à la feuille unifiée `ImportExportSheet`, qui
// n'a, elle, plus qu'un aller-retour par requête d'export au lieu d'un
// composant monté par écran ; ses trois points de montage en comptent quatre
// tout de même, ses deux styles d'accueil étant exclusifs (`app/(app)/
// collection/page.tsx` rend `CollectionView` **ou** `ShelvesView`, jamais les
// deux) — une seule de ces deux entrées est montée à l'exécution.
const SHEET_MOUNTERS: Record<string, string[]> = {
  '<LookSheet': [
    'app/(app)/decks/[id]/deck-view.tsx',
    'components/binders/container-action-sheets.tsx',
  ],
  '<ShareSheet': [
    'app/(app)/decks/[id]/deck-view.tsx',
    'components/binders/container-action-sheets.tsx',
  ],
  '<ListExportSheet': [
    'app/(app)/decks/[id]/deck-view.tsx',
    'components/binders/container-action-sheets.tsx',
  ],
  '<ImportExportSheet': [
    'app/(app)/collection/collection-view.tsx',
    'app/(app)/collection/shelves-view.tsx',
    // Le `···` du container racine expose la même feuille unifiée.
    'app/(app)/container/[id]/container-view.tsx',
  ],
}

const SHEET_MOUNTS = Object.keys(SHEET_MOUNTERS)

function collectSources(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) files.push(...collectSources(fullPath))
    else if (fullPath.endsWith('.tsx')) files.push(fullPath)
  }
  return files
}

describe('binder action sheets have a single mount point', () => {
  const sources = [
    ...collectSources(join(process.cwd(), 'app')),
    ...collectSources(join(process.cwd(), 'components')),
  ]

  it.each(SHEET_MOUNTS)('%s is mounted only by the screens that own it', (mount) => {
    const mounters = sources
      .filter((file) => readFileSync(file, 'utf-8').includes(mount))
      .map((file) => relative(process.cwd(), file).split(sep).join('/'))
      .sort()

    expect(mounters).toEqual([...SHEET_MOUNTERS[mount]!].sort())
  })

  it('leaves BinderHeader free of any sheet, so the desktop header reaches the same ones', () => {
    const header = readFileSync(join(process.cwd(), 'components/binders/binder-header.tsx'), 'utf-8')
    for (const mount of SHEET_MOUNTS) expect(header).not.toContain(mount)
    expect(header).not.toContain('<Sheet')
  })
})
