// Préférences de compte : les huit colonnes posées sur `users`
// (`packages/db/src/schema.ts`), lues et validées ici pour la première fois
// derrière un contrat unique — jusqu'ici chaque feature lisait sa propre
// colonne au fil de l'eau (`getContainerHeader`, `getCollectionHome`…), aucune
// n'écrivait. Toujours sur le compte, jamais dans `localStorage`
// (docs/development.md), pour que mobile et desktop concordent.
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import {
  ACCENT_COLORS,
  COLOR_SCHEMES,
  users,
  type AccentColor,
  type ColorScheme,
  type Density,
  type LayoutStyle,
  type PriceSource,
  type SidebarNodeKey,
} from '@spellcache/db/schema'
import { db } from '@spellcache/db'

export interface Preferences {
  collectionStyle: LayoutStyle
  density: Density
  previewPane: boolean
  pricesOnArt: boolean
  binderBackdrops: boolean
  priceSource: PriceSource
  // Outils de table : une préférence de compte comme les autres —
  // seul l'état de partie `lifeGame` vit en local (docs/development.md).
  toolLifeTracker: boolean
  // Nœuds repliés de la barre latérale desktop — sur le compte, pas dans le
  // navigateur, pour qu'une reconnexion depuis un autre poste retrouve le
  // même arbre.
  sidebarCollapsed: SidebarNodeKey[]
  // Thème : accent de l'interface et fond noir pur (OLED), posés sur `<html>`
  // par le layout racine (`lib/theme.ts`).
  accentColor: AccentColor
  pureBlack: boolean
  colorScheme: ColorScheme
}

// Mêmes valeurs que les défauts de colonne posés en migration
// (`packages/db/migrations/0004_dark_george_stacy.sql`) — un compte neuf lit
// donc la même chose ici et en base, jamais deux sources qui dérivent
// (`cardmarket_eur` reste le défaut).
export const DEFAULT_PREFERENCES: Preferences = {
  collectionStyle: 'compact',
  density: 'compact',
  previewPane: true,
  pricesOnArt: true,
  binderBackdrops: true,
  priceSource: 'cardmarket_eur',
  toolLifeTracker: false,
  sidebarCollapsed: [],
  accentColor: 'gold',
  pureBlack: false,
  colorScheme: 'dark',
}

// Toute entrée externe validée à la frontière (docs/development.md) avant d'atteindre
// `updatePreferenceAction` — un patch partiel : la page envoie une seule
// préférence à la fois, jamais l'objet complet. `.strict()` rejette une clé
// hors contrat plutôt que de la laisser passer silencieusement.
export const preferencesSchema: z.ZodType<Partial<Preferences>> = z
  .object({
    collectionStyle: z.enum(['compact', 'shelves']).optional(),
    density: z.enum(['rows', 'compact', 'grid']).optional(),
    previewPane: z.boolean().optional(),
    pricesOnArt: z.boolean().optional(),
    binderBackdrops: z.boolean().optional(),
    priceSource: z.enum(['tcgplayer_usd', 'cardmarket_eur']).optional(),
    toolLifeTracker: z.boolean().optional(),
    // Énumération fermée : un identifiant libre laisserait entrer n'importe
    // quelle chaîne dans la colonne jsonb (docs/development.md — toute entrée externe
    // validée à la frontière, jamais castée).
    sidebarCollapsed: z.array(z.enum(['collection', 'decks'])).optional(),
    accentColor: z.enum(ACCENT_COLORS).optional(),
    pureBlack: z.boolean().optional(),
    colorScheme: z.enum(COLOR_SCHEMES).optional(),
  })
  .strict()

export async function getPreferences(userId: string): Promise<Preferences> {
  const [row] = await db
    .select({
      collectionStyle: users.collectionStyle,
      density: users.density,
      previewPane: users.previewPane,
      pricesOnArt: users.pricesOnArt,
      binderBackdrops: users.binderBackdrops,
      priceSource: users.priceSource,
      toolLifeTracker: users.toolLifeTracker,
      sidebarCollapsed: users.sidebarCollapsed,
      accentColor: users.accentColor,
      pureBlack: users.pureBlack,
      colorScheme: users.colorScheme,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!row) {
    throw new Error(`User ${userId} not found.`)
  }

  return row
}

// Unique source de vérité pour la devise/le marché (docs/development.md) : les deux
// lignes `Currency`/`Price source` de Settings dérivent toutes deux de
// `priceSource`, jamais d'un état local propre. Définies
// dans `lib/price-source.ts` (pas de `import { db }` là-bas) pour rester
// importables depuis l'îlot client `preference-controls.tsx` sans tirer
// `pg` dans le bundle navigateur ; réexportées ici pour garder un contrat
// unique.
export { currencyOf, marketLabelOf } from '@/lib/price-source'
