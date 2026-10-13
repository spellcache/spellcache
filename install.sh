#!/bin/sh
# Installation et mise à jour de spellcache sur un serveur avec Docker.
#
#   curl -fsSL https://get.spellcache.com | sh
#
# Télécharge seulement ce qu'une release utilise (Compose, .env.example, scripts
# de sauvegarde) : ni clone, ni build. Les fichiers gardent leur place dans le
# dépôt, si bien que docs/self-hosting.md et deploy/cron.md s'appliquent tels
# quels au répertoire installé.
#
# Premier lancement : génère les secrets, demande ce qui ne peut pas l'être
# (URL publique, e-mail de l'admin, clé Resend), démarre la pile et met en file
# l'import du catalogue. Relancé sur une installation existante : met à jour
# les fichiers et l'image vers la release visée, sans toucher au reste du .env.
#
# Variables d'environnement, toutes optionnelles :
#   SPELLCACHE_DIR      répertoire d'installation, /srv/spellcache par défaut
#   SPELLCACHE_VERSION  version à installer (1.2.3), la dernière release sinon
#   SPELLCACHE_URL, SPELLCACHE_ADMIN_EMAIL, RESEND_API_KEY, RESEND_FROM_EMAIL
#                       réponses aux questions, pour une installation sans
#                       terminal interactif
#
# POSIX sh et non bash : `curl | sh` passe par le sh du système (dash sur
# Debian). Tout le script est dans `main`, appelé à la dernière ligne : un
# téléchargement interrompu n'exécute rien.

set -eu

REPO=spellcache/spellcache
# Remplacé par le tag de la release au moment de la publier (workflow
# Release) : le script installe alors la version avec laquelle il a été publié.
RELEASE_TAG=''

FILES='docker-compose.example.yml .env.example deploy/backup.sh deploy/restore.sh deploy/cron.md'
COMPOSE_FILE=docker-compose.example.yml

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required. $2"
}

# Le script arrive par l'entrée standard (`curl | sh`) : les réponses sont lues
# sur le terminal, jamais sur stdin.
has_tty() {
  # Un terminal de contrôle peut exister sans être ouvrable (cron, CI). Test
  # dans un sous-shell : l'échec d'une redirection sur une commande spéciale
  # comme `:` terminerait le script lui-même.
  (: </dev/tty) 2>/dev/null
}

ask() {
  # ask <variable> <question> [défaut]
  if [ -n "$(eval "printf '%s' \"\${$1:-}\"")" ]; then
    return
  fi
  has_tty || fail "$1 is not set and there is no terminal to ask for it."
  if [ -n "${3:-}" ]; then
    printf '%s [%s]: ' "$2" "$3" >/dev/tty
  else
    printf '%s: ' "$2" >/dev/tty
  fi
  IFS= read -r answer </dev/tty || answer=''
  [ -n "$answer" ] || answer=${3:-}
  [ -n "$answer" ] || fail "$2: a value is required."
  eval "$1=\$answer"
}

secret_hex() {
  # Alphanumérique : ces mots de passe finissent dans des URL de connexion.
  openssl rand -hex "$1"
}

latest_tag() {
  curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
    sed -n 's/^ *"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1
}

fetch() {
  # fetch <tag> <chemin dans le dépôt> : écrit au même chemin, via un fichier
  # temporaire pour ne jamais laisser un fichier tronqué.
  mkdir -p "$(dirname "$2")"
  curl -fsSL "https://raw.githubusercontent.com/$REPO/$1/$2" -o "$2.part" ||
    fail "could not download $2 for $1."
  mv "$2.part" "$2"
}

set_env() {
  # set_env <clé> <valeur> : remplace la ligne `CLÉ=` ou `# CLÉ=` du .env,
  # l'ajoute sinon. awk et ENVIRON plutôt que sed : les secrets base64
  # contiennent `/` et `+`.
  case $2 in
    *' '*) value="\"$2\"" ;;
    *) value=$2 ;;
  esac
  # umask 077 : le fichier temporaire, puis le .env qu'il remplace, restent en 600.
  (
    umask 077
    KEY=$1 VALUE=$value awk '
      BEGIN { key = ENVIRON["KEY"]; line = key "=" ENVIRON["VALUE"]; done = 0 }
      !done && ($0 ~ "^" key "=" || $0 ~ "^# " key "=") { print line; done = 1; next }
      { print }
      END { if (!done) print line }
    ' .env >.env.part
  )
  mv .env.part .env
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

check_requirements() {
  need curl 'Install it with your package manager.'
  need openssl 'Install it with your package manager (it also encrypts backups).'
  need docker 'See https://docs.docker.com/engine/install/'
  docker compose version >/dev/null 2>&1 ||
    fail 'the Docker Compose v2 plugin (docker compose) is required.'
  docker info >/dev/null 2>&1 ||
    fail 'cannot reach the Docker daemon. Run as root, or add your user to the docker group.'
}

resolve_version() {
  [ "${SPELLCACHE_VERSION:-}" != latest ] || SPELLCACHE_VERSION=''
  tag=${SPELLCACHE_VERSION:+v${SPELLCACHE_VERSION#v}}
  tag=${tag:-$RELEASE_TAG}
  tag=${tag:-$(latest_tag)}
  [ -n "$tag" ] || fail 'could not find the latest release on GitHub.'
  version=${tag#v}
}

download_files() {
  step "Downloading spellcache $version into $dir"
  for file in $FILES; do
    fetch "$tag" "$file"
  done
  chmod +x deploy/backup.sh deploy/restore.sh
}

configure() {
  step 'Configuration'
  say 'Answers are written to .env; every value can be changed there later.'
  ask SPELLCACHE_URL 'Public URL of the app, with https://'
  case $SPELLCACHE_URL in
    https://* | http://*) ;;
    *) SPELLCACHE_URL="https://$SPELLCACHE_URL" ;;
  esac
  SPELLCACHE_URL=${SPELLCACHE_URL%/}
  ask SPELLCACHE_ADMIN_EMAIL 'Email of the first administrator'
  ask RESEND_API_KEY 'Resend API key (sign-in emails)'
  ask RESEND_FROM_EMAIL 'Sender of sign-in emails, on a domain verified in Resend' \
    "spellcache <signin@${SPELLCACHE_URL#*://}>"

  postgres_password=$(secret_hex 24)
  # Créé directement en 600 : le fichier reçoit des secrets juste après.
  (umask 077 && cp .env.example .env)
  set_env SPELLCACHE_VERSION "$version"
  set_env AUTH_SECRET "$(openssl rand -base64 32)"
  set_env AUTH_URL "$SPELLCACHE_URL"
  set_env ADMIN_EMAIL "$SPELLCACHE_ADMIN_EMAIL"
  set_env RESEND_API_KEY "$RESEND_API_KEY"
  set_env RESEND_FROM_EMAIL "$RESEND_FROM_EMAIL"
  set_env POSTGRES_USER spellcache
  set_env POSTGRES_PASSWORD "$postgres_password"
  set_env POSTGRES_DB spellcache
  set_env REDIS_PASSWORD "$(secret_hex 24)"
  # Vue de l'hôte, pour deploy/backup.sh et deploy/restore.sh uniquement : les
  # conteneurs reçoivent leur propre URL du fichier Compose.
  set_env DATABASE_URL "postgres://spellcache:$postgres_password@127.0.0.1:5432/spellcache"
}

start() {
  step 'Starting the containers (the first start pulls the images)'
  compose pull --quiet
  # `--wait` rend la main quand tous les services sont `healthy` : `web` a
  # appliqué les migrations et `worker` attend des jobs.
  compose up -d --wait --wait-timeout 600 ||
    fail "the containers did not become healthy. See: cd $dir && docker compose -f $COMPOSE_FILE logs"
}

install() {
  configure
  start
  step 'Queueing the card catalogue import'
  compose exec -T worker node apps/worker/src/index.ts --run-now
  say 'The import runs in the background (twenty minutes to an hour).'

  web_port=$(sed -n 's/^WEB_PORT=//p' .env)
  cat <<EOF

spellcache $version is running in $dir.

Next steps:
  1. Point your HTTPS reverse proxy to 127.0.0.1:${web_port:-3000} for $SPELLCACHE_URL
     (docs: https://github.com/$REPO/blob/$tag/docs/self-hosting.md#4-reverse-proxy).
  2. Sign in at $SPELLCACHE_URL with $SPELLCACHE_ADMIN_EMAIL: it becomes the admin.
  3. Set up the nightly run and the backups: $dir/deploy/cron.md.

Follow the catalogue import:
  cd $dir && docker compose -f $COMPOSE_FILE logs -f worker
EOF
}

update() {
  previous=$(sed -n 's/^SPELLCACHE_VERSION=//p' .env)
  step "Updating spellcache ${previous:-latest} to $version"
  set_env SPELLCACHE_VERSION "$version"
  start
  docker image prune -f >/dev/null
  cat <<EOF

spellcache $version is running in $dir.

If a container refuses to start because a variable "must be set in .env",
compare .env with the new .env.example and add the missing value.
EOF
}

main() {
  check_requirements
  resolve_version

  dir=${SPELLCACHE_DIR:-/srv/spellcache}
  if ! mkdir -p "$dir" 2>/dev/null || [ ! -w "$dir" ]; then
    fail "cannot write to $dir. Run as root (curl ... | sudo sh) or set SPELLCACHE_DIR."
  fi
  cd "$dir"

  if [ -f .env ]; then
    download_files
    update
  else
    download_files
    install
  fi
}

main "$@"
