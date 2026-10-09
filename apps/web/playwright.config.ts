import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

// `pnpm dev` (le `webServer` ci-dessous) charge lui-même le `.env` racine
// (apps/web/next.config.ts), mais le process Playwright qui exécute les
// fichiers de spec ne le fait pas. `tests/e2e/collection-home.spec.ts` (cas
// « collection peuplée ») a besoin de `process.env.DATABASE_URL` dans ce
// process-ci pour écrire des holdings réels en base sans passer par l'écran
// d'ajout de carte.
// `loadEnvFile` est une API Node native (>=20.6) : aucune dépendance
// ajoutée. Silencieux si `.env` est absent (CI qui exporte déjà ses
// variables, ou cette sandbox sans Postgres) ou sur un Node trop ancien
// pour l'API.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
} catch {
  // Volontairement silencieux — voir commentaire ci-dessus.
}

// Fichier de secours du transport de lien magique : `tests/e2e/login.spec.ts`
// et `tests/e2e/auth.setup.ts` en lisent un dérivé (un fichier par
// destinataire, voir tests/e2e/read-magic-link.ts) plutôt que de parser la
// sortie standard du process `pnpm dev` — voir lib/mail/resend.ts.
export const MAGIC_LINK_DEBUG_FILE = fileURLToPath(
  new URL('./test-results/last-magic-link.json', import.meta.url),
)

// Session authentifiée réutilisée par les specs qui exercent des routes
// gardées par `middleware.ts` sans re-tester la connexion elle-même
// (`smoke.spec.ts`, `search.spec.ts`) — produite une fois par
// `tests/e2e/auth.setup.ts` via un vrai cycle de lien magique, pas un cookie
// fabriqué à la main.
export const AUTH_STORAGE_STATE_FILE = fileURLToPath(
  new URL('./test-results/auth-storage-state.json', import.meta.url),
)

export default defineConfig({
  testDir: './tests/e2e',
  // Inscriptions ouvertes le temps de la suite (réglage `invite` par
  // défaut) — voir tests/e2e/global-setup.ts.
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:3000',
    // Fenêtre mobile par défaut (docs/development.md : « application web, mobile
    // d'abord »). Avant le layout desktop, aucun écran ne changeait de forme
    // avec la largeur, et les seize specs d'alors s'exécutaient à la fenêtre par
    // défaut de Playwright — 1280×720, qui franchit désormais les deux
    // points de bascule de `lib/breakpoints.ts` : la barre latérale
    // remplacerait la barre d'onglets et `page.locator('nav a')` de
    // `life-tracker.spec.ts` compterait les liens de la barre latérale,
    // `page.getByRole('navigation')` de `smoke.spec.ts` en trouverait deux.
    // Épingler la fenêtre rend explicite ce que chacune de ces specs
    // supposait implicitement ; les deux specs desktop la surchargent par
    // `test.use({ viewport })`.
    viewport: { width: 390, height: 844 },
  },
  projects: [
    {
      // Rejoue le cycle de lien magique une fois et sauvegarde la session
      // qui en résulte — jamais un cookie fabriqué à la main, la garde de
      // session posée par `middleware.ts` n'est pas contournée.
      name: 'setup',
      testMatch: /auth\.setup\.ts$/,
    },
    {
      // `login.spec.ts` exerce le parcours non authentifié de bout en bout :
      // il ne doit démarrer avec aucune session préexistante.
      // `collection-home.spec.ts` et `container-list.spec.ts` rejouent chacun
      // leur propre cycle de lien magique pour la même raison — un compte
      // fraîchement connecté reçoit toujours une collection vide, ce qui les
      // isole d'une mutation laissée par un run précédent sur la session
      // partagée `authenticated`. `command-bar.spec.ts` et
      // `multi-select.spec.ts` suivent le même besoin. `shelves.spec.ts`
      // bascule `users.collection_style` en base directement — même besoin d'un
      // compte neuf isolé. `binder-look.spec.ts` crée son propre binder en base
      // pour la même raison. `settings.spec.ts` rejoue lui aussi son propre
      // cycle de lien magique par test. `decks.spec.ts` crée ses propres decks
      // en base pour la même raison. `deck-builder.spec.ts` crée son propre
      // deck et sa propre carte en base, même besoin. `deck-lifecycle.spec.ts`
      // crée son propre deck, ses propres cartes et son propre compte par test,
      // même besoin. `deck-folders.spec.ts` bascule `users.deck_style` en base
      // et crée ses propres dossiers et decks par test, même besoin.
      // `public-share.spec.ts` crée son propre deck et ses propres cartes par
      // test, et surtout ouvre un `browser.newContext()` vierge pour lire la
      // page publique : partir d'une session partagée rendrait ce contraste
      // illisible. `life-tracker.spec.ts` a besoin d'un compte neuf dont
      // l'outil est encore éteint pour vérifier les quatre onglets et le 404,
      // et ouvre lui aussi un contexte vierge (navigateur sans Wake Lock).
      // `desktop.spec.ts` et `responsive.spec.ts` créent chacun leur compte,
      // leurs cartes, leur binder et leur dossier de decks, et surchargent la
      // fenêtre épinglée plus haut — même besoin d'un compte neuf isolé. Un
      // fichier de spec absent de ces trois regex (`setup`, `unauthenticated`,
      // `authenticated`) n'est collecté par aucun projet et ne s'exécute
      // jamais, silencieusement (piège vérifié via `npx playwright test
      // --list`).
      name: 'unauthenticated',
      testMatch:
        /(login|collection-home|container-list|command-bar|multi-select|shelves|binder-look|settings|decks|deck-builder|deck-lifecycle|deck-folders|public-share|life-tracker|desktop|responsive)\.spec\.ts$/,
    },
    {
      // `smoke.spec.ts` et `search.spec.ts` visitent des routes désormais
      // gardées par `middleware.ts` sans jamais se connecter —
      // `dependencies: ['setup']` leur fournit une session valide au lieu
      // d'affaiblir la garde.
      name: 'authenticated',
      testMatch: /(smoke|search)\.spec\.ts$/,
      dependencies: ['setup'],
      use: {
        storageState: AUTH_STORAGE_STATE_FILE,
      },
    },
  ],
  // En CI, le build de production (construit par l'étape précédente du job) :
  // `pnpm dev` compile chaque route à sa première visite, et la suite
  // dépasse alors ses délais d'attente. En local, le serveur de dev déjà lancé
  // est réutilisé.
  webServer: {
    command: process.env.CI ? 'pnpm start' : 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { MAGIC_LINK_DEBUG_FILE },
  },
})
