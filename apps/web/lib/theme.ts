// Thème du compte (accent, fond noir pur, clair/sombre) traduit en attributs
// de `<html>`, lus par les blocs `:root[data-accent]`,
// `:root[data-pure-black]` et `:root[data-scheme]` de app/globals.css. Rendu côté serveur par le layout racine : la première
// peinture porte déjà le bon thème, jamais l'or par défaut le temps d'un
// effet client. Sans session (login, partage public), le thème par défaut.
import { eq } from 'drizzle-orm'
import { cache } from 'react'

import { users } from '@spellcache/db/schema'
import { auth } from '@/lib/auth'
import { db } from '@spellcache/db'
import { themeAttributes, type ThemeAttributes } from '@/lib/theme-attributes'

// `cache` : lu deux fois par requête, par `generateViewport` et par le layout.
export const getThemeAttributes = cache(async (): Promise<ThemeAttributes> => {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return {}

  const [row] = await db
    .select({
      accentColor: users.accentColor,
      pureBlack: users.pureBlack,
      colorScheme: users.colorScheme,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  return row ? themeAttributes(row.accentColor, row.pureBlack, row.colorScheme) : {}
})
