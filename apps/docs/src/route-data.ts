// Date « Last updated » de chaque page, lue dans l'historique git.
//
// Au build, Starlight ne relève les dates que des fichiers sous
// `src/content/docs/` : les pages vivent dans docs/ à la racine du dépôt
// (content.config.ts), aucune n'avait donc de date. `entry.filePath` est
// relatif à la racine du projet Astro (apps/docs), d'où astro est lancé ; pas
// `import.meta.url`, qui pointe vers le bundle une fois le site construit.
import { execFileSync } from 'node:child_process'

import { defineRouteMiddleware } from '@astrojs/starlight/route-data'

// Une commande git par fichier et par build, pas une par rendu de page.
const dates = new Map<string, Date | undefined>()

function newestCommitDate(filePath: string): Date | undefined {
  if (!dates.has(filePath)) {
    let date: Date | undefined
    try {
      const seconds = execFileSync('git', ['log', '-1', '--format=%ct', '--', filePath], {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).trim()
      // Fichier jamais commité (nouvelle page en cours d'écriture) : pas de date.
      date = seconds ? new Date(Number(seconds) * 1000) : undefined
    } catch {
      date = undefined
    }
    dates.set(filePath, date)
  }
  return dates.get(filePath)
}

export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute
  // `lastUpdated: false` en front matter (accueil) : rien à afficher.
  if (route.entry.data.lastUpdated === false || route.lastUpdated) return
  route.lastUpdated = newestCommitDate(route.entry.filePath)
})
