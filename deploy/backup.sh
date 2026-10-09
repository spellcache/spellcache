#!/usr/bin/env bash
# Sauvegarde quotidienne des seules tables utilisateur.
#
#   usage: backup.sh <dest-uri>
#   sort 0 en cas de succès, écrit <date>-spellcache-user.sql.gz.enc
#   tables incluses : users, accounts, sessions, verification_tokens,
#     collections, collection_members, containers, holdings, container_stats,
#     deck_folders, import_lists, site_settings
#   tables exclues  : cards, sets, card_prices, import_runs
#
# Le catalogue n'est PAS sauvegardé : il se réimporte en une commande
# (`pnpm import:bulk`), et l'inclure multiplierait la taille de l'archive par
# cent pour des données reconstructibles. Les données de compte, elles,
# sont irremplaçables (docs/development.md, « Key architectural decisions »).
#
# Le dump est `--data-only` : le schéma vient des migrations Drizzle versionnées,
# jamais de l'archive. Deux raisons, dans cet ordre :
#   1. un dump sélectif AVEC schéma emporte les clés étrangères des tables
#      retenues, dont `holdings.card_id → cards.id` : il serait irrestaurable
#      tant que `cards` n'existe pas ;
#   2. le schéma a déjà une source de vérité versionnée (packages/db/migrations), en
#      avoir une seconde dans chaque archive les ferait diverger.
# `deploy/restore.sh` restaure donc sur une base déjà migrée — voir son en-tête.
#
# Variables d'environnement (voir .env.example) :
#   DATABASE_URL           obligatoire — base à sauvegarder
#   BACKUP_PASSPHRASE      obligatoire — chiffrement AES-256 de l'archive
#   BACKUP_RETENTION_DAYS  optionnel   — rotation, 30 jours par défaut
#
# Ce fichier est aussi sourçable (`source deploy/backup.sh`) : `main` ne
# s'exécute alors pas, ce qui permet de tester les fonctions une à une
# (tests/integration/backup-restore.test.ts).

set -euo pipefail

# --- Contrat des tables ------------------------------------------------------
#
# Ces douze noms sont l'énumération exacte des tables utilisateur de
# packages/db/src/schema.ts. Les quatre du catalogue sont listées séparément pour que la
# vérification puisse affirmer leur ABSENCE, pas seulement la présence des
# autres.
USER_TABLES=(
  users
  accounts
  sessions
  verification_tokens
  collections
  collection_members
  containers
  holdings
  container_stats
  deck_folders
  import_lists
  # Réglages du site (mode d'inscription) : choisis par un admin, pas
  # reconstructibles.
  site_settings
)

CATALOGUE_TABLES=(cards sets card_prices import_runs)

ARCHIVE_SUFFIX='-spellcache-user.sql.gz.enc'
DEFAULT_RETENTION_DAYS=30

user_tables() {
  printf '%s\n' "${USER_TABLES[@]}"
}

catalogue_tables() {
  printf '%s\n' "${CATALOGUE_TABLES[@]}"
}

archive_name() {
  local day="${1:-$(date -u +%Y-%m-%d)}"
  printf '%s%s\n' "${day}" "${ARCHIVE_SUFFIX}"
}

# --- Chiffrement -------------------------------------------------------------
#
# AES-256-CBC avec dérivation PBKDF2 et sel aléatoire. La phrase secrète passe
# par l'environnement (`-pass env:`), jamais par la ligne de commande, qui est
# lisible par tout process de la machine.
encrypt_stream() {
  openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE
}

decrypt_stream() {
  openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE
}

# --- Inspection d'un dump ----------------------------------------------------
#
# Liste les tables réellement présentes dans un dump SQL lu sur l'entrée
# standard. L'automate suit les blocs `COPY ... FROM stdin;` et ne lit jamais
# leur contenu : une valeur textuelle qui ressemblerait à un ordre `COPY` — un
# nom de deck, par exemple — ne peut donc pas fabriquer une table fantôme.
list_dump_tables() {
  awk '
    inside == 0 && /^COPY [^ ]+ / { name = $2; sub(/^public\./, "", name); print name; inside = 1; next }
    inside == 1 && $0 == "\\." { inside = 0 }
  ' | LC_ALL=C sort -u
}

# Échoue si le dump ne contient pas EXACTEMENT les tables utilisateur. Une table
# manquante, c'est une perte de données silencieuse
# découverte au moment de la restauration ; une table de catalogue en trop,
# c'est une archive cent fois trop grosse. Les deux arrêtent la sauvegarde ici.
assert_dump_tables() {
  local dump_path="$1"
  local expected actual
  expected="$(user_tables | LC_ALL=C sort)"
  actual="$(list_dump_tables < "${dump_path}")"

  if [ "${expected}" != "${actual}" ]; then
    echo "[backup] table set mismatch in the dump" >&2
    echo "--- expected ---" >&2
    echo "${expected}" >&2
    echo "--- actual ---" >&2
    echo "${actual}" >&2
    return 1
  fi

  local table
  for table in "${CATALOGUE_TABLES[@]}"; do
    if printf '%s\n' "${actual}" | grep -qx "${table}"; then
      echo "[backup] catalogue table '${table}' must never be in the archive" >&2
      return 1
    fi
  done
}

# --- Rotation ----------------------------------------------------------------
#
# Ne vise que nos propres archives (`-name '*-spellcache-user.sql.gz.enc'`) et
# jamais un sous-répertoire : la destination peut contenir autre chose, une
# sauvegarde ne doit rien détruire d'étranger à elle-même.
rotate_local() {
  local dir="$1"
  local days="$2"
  find "${dir}" -maxdepth 1 -type f -name "*${ARCHIVE_SUFFIX}" -mtime "+${days}" -print -delete
}

rotate_remote() {
  local host="$1"
  local dir="$2"
  local days="$3"
  ssh "${host}" "find '${dir}' -maxdepth 1 -type f -name '*${ARCHIVE_SUFFIX}' -mtime '+${days}' -print -delete"
}

# --- Destination -------------------------------------------------------------
#
# Deux schémas d'URI seulement, tous deux hors du VPS :
#   file:///chemin/absolu           montage distant, disque secondaire
#   ssh://utilisateur@hote:/chemin  copie par scp
# Tout autre schéma est refusé plutôt qu'interprété au hasard.
ship_archive() {
  local archive="$1"
  local dest="$2"
  local days="$3"

  case "${dest}" in
    file://*)
      local dir="${dest#file://}"
      mkdir -p "${dir}"
      cp "${archive}" "${dir}/"
      echo "[backup] stored ${dir}/$(basename "${archive}")"
      rotate_local "${dir}" "${days}"
      ;;
    ssh://*)
      local rest="${dest#ssh://}"
      local host="${rest%%:*}"
      local dir="${rest#*:}"
      if [ -z "${host}" ] || [ -z "${dir}" ] || [ "${host}" = "${rest}" ]; then
        echo "[backup] malformed ssh destination: ${dest} (expected ssh://user@host:/path)" >&2
        return 2
      fi
      scp -q "${archive}" "${host}:${dir}/"
      echo "[backup] stored ${host}:${dir}/$(basename "${archive}")"
      rotate_remote "${host}" "${dir}" "${days}"
      ;;
    *)
      echo "[backup] unsupported destination: ${dest} (expected file:// or ssh://)" >&2
      return 2
      ;;
  esac
}

# --- Programme ---------------------------------------------------------------

main() {
  local dest="${1:-}"
  if [ -z "${dest}" ]; then
    echo "usage: backup.sh <dest-uri>" >&2
    return 2
  fi
  : "${DATABASE_URL:?DATABASE_URL is not set}"
  : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"

  local days="${BACKUP_RETENTION_DAYS:-${DEFAULT_RETENTION_DAYS}}"
  local name
  name="$(archive_name)"

  local workdir
  workdir="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '${workdir}'" EXIT

  local dump="${workdir}/dump.sql"
  local args=()
  local table
  for table in "${USER_TABLES[@]}"; do
    args+=(--table="public.${table}")
  done

  echo "[backup] dumping ${#USER_TABLES[@]} user tables"
  # `--data-only` : voir l'en-tête. `--no-owner`/`--no-privileges` : l'archive
  # doit se restaurer sur une base dont le rôle propriétaire porte un autre nom.
  pg_dump "${DATABASE_URL}" \
    --data-only \
    --no-owner \
    --no-privileges \
    --no-comments \
    "${args[@]}" >"${dump}"

  # Vérification AVANT chiffrement : une archive fausse ne doit jamais partir.
  assert_dump_tables "${dump}"

  local archive="${workdir}/${name}"
  gzip -9 -c "${dump}" | encrypt_stream >"${archive}"
  echo "[backup] wrote ${name} ($(wc -c <"${archive}") bytes, encrypted)"

  ship_archive "${archive}" "${dest}" "${days}"
  echo "[backup] done"
}

# Exécute `main` seulement en invocation directe : sourcé, ce fichier n'expose
# que ses fonctions.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
