import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { NextConfig } from 'next'

// Racine du dépôt (workspace pnpm) : l'app vit dans apps/web.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

// Un seul `.env`, à la racine du dépôt, partagé avec le worker et
// drizzle-kit. Next ne lit d'office que celui de son propre dossier ; une
// variable déjà présente dans l'environnement n'est jamais écrasée.
const rootEnvFile = `${repoRoot}.env`
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile)

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Image de production autonome : `next build` émet
  // `.next/standalone/` avec le sous-ensemble de `node_modules` réellement
  // tracé, ce qui donne une image finale sans dépendances de build. Le
  // traçage part de la racine du dépôt pour suivre les packages du
  // workspace : le serveur se retrouve en `apps/web/server.js` dans la
  // sortie.
  outputFileTracingRoot: repoRoot,
  //
  // Attention : le répertoire d'exécution change (`server.js` se place dans
  // son dossier, `process.cwd()` vaut `/app/apps/web` dans l'image et non
  // plus la racine du dépôt). `app/api/card-image/[cardId]/[variant]/route.ts` retombe
  // sur `join(process.cwd(), 'thumbs')` faute de `THUMBNAILS_DIR` — d'où
  // `THUMBNAILS_DIR=/app/thumbs` posé explicitement dans
  // `docker-compose.example.yml`, avec le volume monté au même chemin. Sans cela
  // le cache disque des vignettes repartirait de zéro à chaque déploiement.
  output: 'standalone',
  // Packages du workspace publiés en sources TypeScript (pas d'étape de
  // build) : Next les compile comme son propre code.
  transpilePackages: ['@spellcache/core', '@spellcache/db'],
  // L'app n'utilise pas `next/image` (les images passent par
  // `app/api/card-image`) : couper l'optimiseur ferme `/_next/image`, une
  // surface exposée par défaut sans aucun usage ici.
  images: { unoptimized: true },
  // Aucune page ne doit être affichable dans une iframe tierce : sans ces
  // en-têtes, un site pourrait superposer l'app et faire cliquer à l'aveugle
  // Delete collection ou Transfer ownership (clickjacking). Posés par Next
  // donc par l'app, pour valoir derrière n'importe quel reverse proxy.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          // L'app porte elle-même ces en-têtes, quel que
          // soit le reverse proxy de l'hébergeur. HSTS revient à celui qui
          // termine le HTTPS.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
  experimental: {
    // Next 15 remet le cache routeur client à zéro pour toute page
    // dynamique : revenir sur un onglet déjà visité refaisait l'aller-retour
    // serveur et rejouait le rendu alors que rien n'avait changé — mesuré à
    // ~335 ms par navigation, dont ~300 ms passés à attendre après l'arrivée
    // du payload (le serveur, lui, répond en 6 ms). Ces durées laissent le
    // routeur servir depuis son cache, ce qui ramène un aller-retour entre
    // onglets à ~30 ms.
    //
    // Sans risque de voir un écran périmé : les mutations appellent
    // `router.refresh()`, qui invalide ce cache. Vérifié sur les deux
    // parcours qui le mettraient en défaut — créer un binder puis revenir à
    // l'accueil, et le renommer depuis son écran alors que l'accueil est
    // déjà en cache avec l'ancien nom.
    staleTimes: { dynamic: 30, static: 180 },
    // `forbidden()` (`GET /settings/users` doit répondre 403 pour un
    // `member`, pas un masquage d'interface) —
    // reste derrière ce drapeau en Next 15.
    authInterrupts: true,
    // Import d'un export CSV de collection : le texte part en entier dans
    // une Server Action (`MAX_LIST_TEXT`, sharing-actions.ts), au-delà du
    // 1 Mo par défaut.
    serverActions: { bodySizeLimit: '4mb' },
  },
}

export default nextConfig
