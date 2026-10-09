#!/bin/sh
# Point d'entrée du conteneur `web`.
#
# Les migrations s'appliquent AVANT que le serveur n'ouvre son port : tant que
# `migrate.mjs` tourne, rien n'écoute sur 3000, le reverse proxy répond 502 et le
# healthcheck garde le service `starting`. Aucune requête n'est donc servie sur
# un schéma périmé. Si les migrations échouent, `set -e` arrête le conteneur —
# `restart: unless-stopped` le relance, et le journal porte l'erreur.
set -eu

echo "[entrypoint] applying database migrations"
node /app/apps/web/migrate.mjs

echo "[entrypoint] starting: $*"
exec "$@"
