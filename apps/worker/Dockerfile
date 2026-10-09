# Image de production du service `worker`.
#
# Le worker exécute ses fichiers `.ts` directement, sans bundler ni loader :
# c'est le décapage de types natif de Node, actif par défaut depuis la 23.6
# (voir docker-compose.yml, service `worker`). Ses sources sont donc l'artefact
# — il n'y a rien à compiler, seulement à installer les dépendances
# d'exécution.
#
# Multi-étapes tout de même : l'installation se fait avec pnpm et le store
# `.pnpm` complet (dépendances de développement comprises pour respecter le
# `--frozen-lockfile`), l'image finale ne reçoit que l'arbre `--prod` et les
# sources nécessaires. Elle ne contient ni pnpm, ni compilateur, ni `.git`.
#
# Le worker n'applique JAMAIS les migrations : c'est `web` qui les applique,
# une seule fois (deux migrateurs en parallèle se disputent le verrou).

FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# --- Dépendances d'exécution -------------------------------------------------
FROM base AS deps
# Manifests du workspace seulement : le lockfile est validé contre eux.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
# `--filter @spellcache/worker...` : le worker et ses dépendances du
# workspace (`@spellcache/core`), rien de l'app web.
# `--prod` : ni Vitest ni types dans l'image.
# `--ignore-scripts` : aucun binaire natif à compiler ici (pg, ioredis, zod et
# pg-copy-streams sont du JavaScript pur).
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @spellcache/worker...

# --- Image finale ------------------------------------------------------------
FROM node:24-alpine AS runner
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs worker

# L'arbre pnpm complet (`node_modules` + son store `.pnpm`) : les liens
# symboliques internes sont relatifs, donc valides une fois l'arbre copié en
# entier.
COPY --from=deps --chown=worker:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=worker:nodejs /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps --chown=worker:nodejs /app/packages/core/node_modules ./packages/core/node_modules
COPY --chown=worker:nodejs apps/worker/package.json ./apps/worker/
COPY --chown=worker:nodejs apps/worker/src ./apps/worker/src
# Le worker importe `@spellcache/core` (sources TypeScript, lien pnpm vers
# packages/core) : Node décape les types parce que le chemin réel n'est pas
# sous `node_modules`.
COPY --chown=worker:nodejs packages/core ./packages/core

# Échoue le build si le décapage de types natif ou une dépendance d'exécution
# manque : mieux vaut un build rouge qu'un conteneur qui redémarre en boucle
# sur le VPS. `src/scheduler.ts` est chargé pour de vrai — il ne lit aucune
# variable d'environnement à l'import, contrairement au reste du graphe. Les
# imports se résolvent depuis le package du worker, d'où le `cd`.
RUN cd apps/worker && node -e "Promise.all([import('pg'), import('ioredis'), import('zod'), import('pg-copy-streams'), import('@spellcache/core/images')]).then(() => console.log('worker deps ok'))"
RUN cd apps/worker && node -e "import('./src/scheduler.ts').then((m) => { if (typeof m.startScheduler !== 'function') { throw new Error('scheduler missing') } console.log('worker entrypoint ok') })"

USER worker
EXPOSE 8081

CMD ["node", "apps/worker/src/index.ts"]
