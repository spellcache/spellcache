# Developing spellcache

Local setup, commands, monorepo layout, conventions and architecture decisions.
Code comments refer to this file (`docs/development.md`, mostly its
conventions and anti-patterns). For the pull request workflow, see the organisation's
`CONTRIBUTING.md`.

## Stack

- **Framework**: Next.js 15 (App Router), React 19, strict TypeScript
- **Internal API**: Server Actions + route handlers, Zod validation at the boundary
- **Database**: PostgreSQL 17 + Drizzle ORM (versioned SQL migrations)
- **Cache / queue**: Redis (Valkey) — search cache, worker job queue, rate limits
- **Server state**: TanStack Query · **Virtualisation**: TanStack Virtual
- **Styles**: Tailwind CSS 4 (design tokens in `@theme`) + Radix Primitives
- **Icons**: `lucide-react`, `stroke-width: 1.75`
- **Auth**: Auth.js v5, Email provider (magic link or code) + Resend, Drizzle adapter
- **Tests**: Vitest (unit + integration) · Playwright (critical paths)
- **Runtime**: Docker Compose — `web`, `worker`, `postgres`, `redis`

## Local setup

Requirements: Node.js 24, pnpm 10 (`corepack enable`), Docker.

```bash
cp .env.example .env          # then set AUTH_SECRET (openssl rand -base64 32)
docker compose up -d postgres redis
pnpm install
pnpm db:migrate
pnpm import:bulk              # downloads the Scryfall bulk data (a few hundred MB)
pnpm dev                      # http://localhost:3000
```

A single `.env` at the repository root is read by every tool (Next.js, the
worker, drizzle-kit, Playwright). Without `RESEND_API_KEY`, sign-in links are
printed in the `pnpm dev` console. The first account created on an empty
database becomes the administrator (only `ADMIN_EMAIL` may create it, if set).

`pnpm dev` downloads the mana symbols from Scryfall into `apps/web/public/mana/`
the first time (they belong to Wizards of the Coast and are never committed).

## Commands

Run from the repository root:

```bash
pnpm dev              # Next.js dev server (apps/web)
pnpm build            # production build of apps/web
pnpm typecheck        # tsc --noEmit in every package — must pass before each commit
pnpm lint             # ESLint over the whole workspace — must pass before each commit
pnpm test             # Vitest, package by package (unit + integration)
pnpm test:e2e         # Playwright (apps/web)
pnpm db:generate      # new Drizzle migration from packages/db/src/schema.ts
pnpm db:migrate       # apply the migrations
pnpm import:bulk      # Scryfall bulk import (also run nightly by the worker)
pnpm worker           # run the worker on the host
docker compose up -d                          # postgres + redis + worker (built locally)
docker compose --profile full up -d --build   # + web, built like in production
```

Integration tests start their own throwaway database (Compose profile `test`,
port 5433) and skip themselves if Docker is not available. Packages run one
after the other: they share that database.

## Monorepo layout

```
.
├── apps/
│   ├── android/            # @spellcache/android — Capacitor shell for Android
│   │   ├── www/            # server selection screen (plain HTML/JS, no build)
│   │   └── android/        # Android Studio project (Gradle)
│   ├── web/                # @spellcache/web — Next.js app
│   │   ├── app/            # App Router: routes, layouts, Server Actions
│   │   ├── components/     # ui/ primitives + cards/, decks/, collection/, …
│   │   ├── lib/            # web-only logic (auth, collections, decks, search…)
│   │   ├── public/         # icons (copied from design/assets/icon at build), sw.js
│   │   ├── scripts/        # copy-assets.mjs, fetch-mana.mjs
│   │   └── tests/          # unit/, integration/, e2e/
│   └── worker/             # @spellcache/worker — bulk import, prices, valuations
│       ├── src/            # run as TypeScript by Node, no build step
│       └── tests/
├── packages/
│   ├── core/               # @spellcache/core — Scryfall client and schemas, image URLs,
│   │                       #   job queue contract; no Next.js dependency
│   └── db/                 # @spellcache/db — Drizzle schema, migrations, PostgreSQL client,
│                           #   shared test database setup (testing/)
├── deploy/                 # backup/restore scripts, migrator, container entrypoint
├── design/assets/icon/     # app icon sources
├── docs/                   # self-hosting.md, development.md
├── docker-compose.yml      # development
└── docker-compose.example.yml  # self-hosting (GHCR images)
```

Rules of the layout:

- Code shared by the web app and the worker lives in `packages/`; code only the
  web app uses stays in `apps/web/lib/`. The worker never imports from
  `apps/web`.
- `packages/*` are published as TypeScript sources (no build): Next.js compiles
  them (`transpilePackages`), Node runs them directly in the worker. Their
  internal relative imports carry the `.ts` extension, and they never use the
  `@/` alias (it only exists in `apps/web`).

## Android app

`apps/android` wraps the web app in a native shell with
[Capacitor](https://capacitorjs.com). The APK contains no copy of the app: its
only local page (`www/`) asks for the address of a spellcache instance, then
opens that instance in the WebView. Everything else is served by the instance,
so the Android app follows the server's version.

- **Navigation**: only the chosen instance's origin stays in the app
  (`ServerPlugin.shouldOverrideLoad`); links to other domains open in the
  browser. Capacitor's bridge is injected into the local page only, never into
  the instance's pages.
- **Back button**: walks the WebView history. From the instance's first page it
  returns to the server screen (to change server); from there it leaves the
  app.
- **Sign-in**: the emailed link opens in the browser, not in the app. In the
  app, sign in with the code from the same email.
- **Requirements on the server**: HTTPS with a certificate Android trusts.
  Plain HTTP and self-signed certificates are refused. The debug build is the
  only exception: it also accepts `http://localhost` (see below).

### Testing on a phone

The debug build is a separate app, **spellcache dev**
(`io.github.spellcache.dev`), installed next to the release one. It accepts
`http://localhost:<port>` in addition to HTTPS servers, so it can open the
local dev server through `adb reverse`:

```bash
pnpm dev            # terminal 1: the web app on port 3000
pnpm android:dev    # terminal 2: sync, adb reverse, install, launch
```

In the app, enter `http://localhost:3000`. Changes to the web app reload on
the phone through HMR; run `pnpm android:dev` again only after changing the
shell (`www/`, Java, `capacitor.config.ts`). Sign in with the code printed by
`pnpm dev` (no Resend key in development).

- **Connection**: USB with *USB debugging* on, or *Wireless debugging* paired
  with `adb pair <ip>:<port>`. The `adb reverse` mapping is lost when the phone
  disconnects: run `pnpm android:dev` again.
- **DevTools**: `chrome://inspect` on the computer lists the app's WebView
  (console, network, elements), for the server screen and the instance alike.
- **Native logs**: `adb logcat`, or Android Studio
  (`pnpm --filter @spellcache/android open`) for breakpoints in Java.
- **Another server**: the dev app also opens any HTTPS instance, to reproduce
  a bug against real data with DevTools.
- `DEV_PORT=3001 pnpm android:dev` when `pnpm dev` runs on another port.

Build locally (Node, JDK 21, Android SDK; Android Studio installs the last two):

```bash
pnpm --filter @spellcache/android sync    # copies www/ into the Android project
cd apps/android/android
./gradlew assembleDebug                   # app/build/outputs/apk/debug/app-debug.apk
```

`pnpm --filter @spellcache/android open` opens the project in Android Studio
(emulator, debugger). Run `sync` again after changing `www/` or
`capacitor.config.ts`.

**Releases**: the `Release` workflow builds a signed APK when release-please
creates a release and attaches it to the GitHub release, with its SHA-256.
release-please bumps `versionName` in `app/build.gradle`; `versionCode` is
derived from it (`1.2.3` → `10203`). Signing uses four repository secrets:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the keystore, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

Create the keystore once and keep a backup outside GitHub: an APK signed with
another key cannot update existing installs.

```bash
keytool -genkeypair -v -keystore spellcache-release.jks -alias spellcache   -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 spellcache-release.jks         # value of ANDROID_KEYSTORE_BASE64
```

## Conventions

- Files and folders in `kebab-case`; React components in `PascalCase`;
  functions and variables in `camelCase`; SQL columns in `snake_case`.
- Components live in `components/<domain>/`, without prefix: card rows and
  tiles in `cards/` (`CompactRow`, `GridTile`…), decks in `decks/`, shelves in
  `collection/`, table tools in `tools/`, the logo in `brand/`, primitives in
  `ui/`.
- **UI copy is in English.** User-facing documentation (README, `docs/`) is in
  English; code comments are in French; identifiers are in English.
- Every external input (form, URL param, payload, Scryfall response) is
  validated by a Zod schema at the boundary, never cast.
- Server Actions for mutations; route handlers only for what must answer raw
  HTTP (images, auth, health).
- Colours, radii, spacing and font sizes come from the Tailwind tokens defined
  in `@theme` (`bg-surface-1`, `text-accent`…). No hard-coded hex. One token
  name per role, even when two roles share a value.
- **Tailwind's dynamic spacing scale is disabled** (`--spacing: initial` in
  `@theme`). A numeric step is always its declared literal value: `py-13` is
  13px, never `calc(var(--spacing) * 13)` = 52px. An undeclared step emits no
  class — the gap shows on screen and in review instead of silently producing a
  wrong value. Add the missing token, never reintroduce a multiplication
  fallback. Values that are not a grid step get a proper name
  (`--spacing-tab-bar-reserve: 96px`, used as `pb-tab-bar-reserve`), not an
  integer that happens to fit.
- Lint and format: ESLint (`next/core-web-vitals` + `@typescript-eslint`) and
  Prettier. `pnpm typecheck && pnpm lint` must pass before every commit.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  they drive the changelog and the version (release-please).
- `main` is the only long-lived branch. release-please keeps a release pull
  request open against it; merging that pull request tags the version,
  publishes the GitHub release, the Docker images and the APK. Dependabot opens
  weekly dependency updates (npm and GitHub Actions, minor and patch grouped).
- Every Drizzle migration is generated (`pnpm db:generate`), reviewed, then
  committed with the feature that introduces it.

## Architecture decisions

- **No Scryfall API call during a user request** — the catalogue is a local
  mirror fed by the bulk files. Ignoring Scryfall's 429 responses can lead to a
  permanent block, and prices only change once a day.
- **`containers` + `holdings` as the single model** for the collection,
  binders, decks and lists — the four screens share the same list, search and
  valuation code.
- **A collection is a shared space**, not an account's property:
  `collections` + `collection_members(role owner|editor|viewer)`. `containers`
  point to a collection, never to a `user_id`.
- **Preferences are stored on the account** (`users` table), not in the
  browser, so mobile and desktop agree. Only `lifeGame` is local.
- **`users.price_source` is the single source of truth** for currency and
  market (`tcgplayer_usd` ⇒ $, `cardmarket_eur` ⇒ €). Both Settings rows edit
  that one value; the app has no currency conversion.
- **Precomputed values in `container_stats`** — the value banner reads one
  row, it never aggregates the holdings on load.
- **Cursor pagination**, never `OFFSET`: infinite scroll over 1,000 cards must
  stay constant-time.
- **Optimistic updates** on every quantity, rolled back on failure.
- **Rebuildable catalogue / irreplaceable user data**: only user tables are
  backed up; the catalogue is re-imported with one command.

## Anti-patterns

- Do NOT call the Scryfall API from the browser or during a user request —
  only two server-side exceptions exist (set released today, card missing from
  the catalogue), capped at 2 req/s through `/cards/collection`.
- Do NOT build Scryfall image URLs by hand: they come from the bulk data.
- Do NOT crop or cover the copyright line or the artist name on a card image.
- Do NOT hard-code a hex value, radius or spacing in a component — use the
  `@theme` tokens. A value missing from the tokens means a missing token, not an
  exception. Only two files hold literal values: `apps/web/app/globals.css` (the
  `@theme` block) and `apps/web/lib/binders/gradients.ts` (the six gradients of
  the pip palette).
- Do NOT store preferences in `localStorage` (except `lifeGame`) — they belong
  to the account.
- Do NOT add `user_id` to `containers`: ownership goes through
  `collection_members`. There is no second authorisation path.
- Do NOT add a second currency setting or an exchange rate: `price_source` is
  unique.
- Do NOT paginate with `OFFSET`, do NOT aggregate holdings when loading a value
  screen.
- Do NOT copy a deck's card list into a dedicated table: a deck is a
  `container`, its cards are `holdings`.
- Do NOT add password authentication or an external OAuth provider.
- Do NOT use variable row heights in a virtualised list.
- Do NOT invent new visual language: features marked `Planned` or `Soon` in
  Settings (Trading mode, Card scanner, AI assistant) stay greyed-out rows with
  no screen, and a new screen is built from existing components and tokens.
  Discuss any visual novelty in an issue first.
- Do NOT cache user data offline: the app is always online; offline use is not
  a requirement.
