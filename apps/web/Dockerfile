# Image de production de l'app web.
# Contexte de build : la racine du monorepo.
#
# Multi-étapes : l'image finale ne contient ni pnpm, ni les dépendances de
# développement, ni les sources — seulement la sortie `output: 'standalone'` de
# Next (`apps/web/server.js` + le sous-ensemble de `node_modules` réellement
# tracé depuis la racine du workspace), les fichiers statiques, `public/`, et
# de quoi appliquer les migrations avant d'ouvrir le port.
#
# Elle tourne en utilisateur non root (`nextjs`, uid 1001).

FROM node:24-alpine AS base
# `libc6-compat` : Next et sharp sont liés à glibc sur certaines plateformes,
# Alpine fournit musl. C'est la recommandation officielle de Next pour Alpine.
RUN apk add --no-cache libc6-compat
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# --- Dépendances -------------------------------------------------------------
FROM base AS deps
# Manifests du workspace seulement : le lockfile est validé contre eux, et
# cette couche reste en cache tant qu'aucune dépendance ne change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
# L'app web et ses dépendances du workspace (`@spellcache/core`,
# `@spellcache/db`), rien du worker.
RUN pnpm install --frozen-lockfile --filter @spellcache/web...

# `drizzle-orm` n'est pas tracé par `output: 'standalone'` (Next l'inclut
# bundlé dans les chunks serveur), et le migrateur en a besoin comme module à
# part entière. Il est déréférencé ici : dans un `node_modules` pnpm, c'est un
# lien symbolique vers le store `.pnpm`, que `COPY --from` recopierait tel
# quel — donc cassé. `drizzle-orm` n'a aucune dépendance d'exécution, la copie
# est autosuffisante.
RUN cp -RL apps/web/node_modules/drizzle-orm /drizzle-orm

# --- Build -------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY . .
# `prebuild` copie icônes et manifest depuis design/assets vers public/
# (scripts/copy-assets.mjs) et télécharge les symboles de mana depuis Scryfall
# (scripts/fetch-mana.mjs) avant que Next ne fige `public/`.
RUN pnpm --filter @spellcache/web build

# --- Image finale ------------------------------------------------------------
FROM node:24-alpine AS runner
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    THUMBNAILS_DIR=/app/thumbs
WORKDIR /app

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

# Sortie standalone tracée depuis la racine du workspace : le serveur vit en
# `apps/web/server.js`. `public/` et `.next/static` n'y sont pas inclus, Next
# demande de les copier à côté du serveur.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Migrations : le SQL versionné, le migrateur Drizzle et le point d'entrée qui
# les applique avant le serveur. Le migrateur vit à côté du serveur, dans
# apps/web/ : c'est là que la sortie standalone place `pg`.
COPY --from=deps --chown=nextjs:nodejs /drizzle-orm ./apps/web/node_modules/drizzle-orm
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/migrations ./apps/web/db/migrations
COPY --chown=nextjs:nodejs deploy/migrate.mjs ./apps/web/migrate.mjs
COPY --chown=nextjs:nodejs deploy/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Le montage échoue à s'initialiser proprement si le point de montage n'existe
# pas déjà avec le bon propriétaire : un volume nommé hérite du propriétaire du
# répertoire de l'image. Sans cela, `/app/thumbs` appartiendrait à root et le
# proxy de vignettes ne pourrait rien y écrire.
RUN mkdir -p /app/thumbs && chown -R nextjs:nodejs /app/thumbs

# Échoue le build, pas le déploiement, si le migrateur ou son pilote manquent :
# une image qui ne sait pas migrer ne doit jamais atteindre le VPS.
RUN cd apps/web && node -e "Promise.all([import('drizzle-orm/node-postgres/migrator'), import('pg')]).then(([m]) => { if (typeof m.migrate !== 'function') { throw new Error('drizzle migrator missing') } console.log('migrator ok') })"

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "apps/web/server.js"]
