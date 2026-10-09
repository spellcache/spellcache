// Compile `app/globals.css` avec le vrai pipeline Tailwind 4 du projet
// (`@tailwindcss/postcss`), pour les tests qui rendent des composants réels
// dans Chromium et mesurent leur boîte compilée plutôt que de calculer une
// hauteur à la main (mesurer, pas calculer). `postcss` n'est pas
// une dépendance directe du projet (pnpm,
// résolution stricte) : requise depuis l'emplacement de `@tailwindcss/postcss`
// (qui la déclare, elle), plutôt que depuis ce fichier.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

// `postcss` et `@tailwindcss/postcss` requis dynamiquement (non typés ici,
// résolution CJS depuis un emplacement tiers) — leur forme exacte n'est
// utile qu'à l'exécution de cette seule fonction.
interface PostcssResult {
  css: string
}
interface PostcssProcessor {
  process(input: string, options: { from: string; to: undefined }): Promise<PostcssResult>
}

export async function compileTailwindCss(): Promise<string> {
  const req = createRequire(import.meta.url)
  const tailwindPluginPath = req.resolve('@tailwindcss/postcss')
  const localRequire = createRequire(tailwindPluginPath)
  const postcss = localRequire('postcss') as (plugins: unknown[]) => PostcssProcessor
  const tailwind = localRequire('@tailwindcss/postcss') as (options: { base: string }) => unknown

  const cssPath = path.resolve(process.cwd(), 'app/globals.css')
  const input = fs.readFileSync(cssPath, 'utf8')
  const result = await postcss([tailwind({ base: path.resolve(process.cwd()) })]).process(input, {
    from: cssPath,
    to: undefined,
  })
  return result.css
}
