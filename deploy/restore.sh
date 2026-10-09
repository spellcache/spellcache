#!/usr/bin/env bash
# Restauration d'une archive de sauvegarde.
#
#   usage: restore.sh <archive> <database-url>
#   restaure les tables utilisateur puis rappelle qu'il faut lancer
#   `pnpm import:bulk`
#
# « Une sauvegarde jamais restaurée n'est pas une sauvegarde » : ce
# script est couvert par tests/integration/backup-restore.test.ts, qui fait
# l'aller-retour complet sur une vraie base.
#
# Ordre imposé, et il compte :
#   1. la base cible existe et porte le schéma à jour (migrations Drizzle) —
#      l'archive ne contient QUE des données, jamais de `CREATE TABLE` ;
#   2. ce script réinjecte les douze tables utilisateur en une transaction, avec
#      `session_replication_role = replica` : `holdings.card_id` et
#      `containers.cover_card_id` référencent `cards`, table de catalogue encore
#      vide à cet instant — sans cela, chaque ligne serait refusée ;
#   3. `pnpm import:bulk` reconstruit le catalogue, ce qui rend ces références
#      à nouveau résolubles.
#
# Le point 2 exige un rôle superutilisateur sur la base cible (c'est le cas de
# `POSTGRES_USER` de l'image officielle).
#
# Variables d'environnement :
#   BACKUP_PASSPHRASE  obligatoire — déchiffrement de l'archive
#   RESTORE_TRUNCATE   optionnel   — `1` pour vider les tables utilisateur déjà
#                                    peuplées avant de restaurer. Sans elle, le
#                                    script refuse de restaurer sur une base non
#                                    vierge plutôt que d'y empiler des doublons.

set -euo pipefail

RESTORE_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Source unique de la liste des tables, du déchiffrement et de l'inspection du
# dump : elle ne doit exister qu'à un seul endroit, sans quoi les deux scripts
# divergeraient sur la table qui compte.
# shellcheck source=./backup.sh
source "${RESTORE_SCRIPT_DIR}/backup.sh"

# Requête « quelles tables utilisateur ne sont pas vides ».
non_empty_tables_query() {
  local parts=() table joined
  for table in "${USER_TABLES[@]}"; do
    parts+=("select '${table}' as t, count(*) as c from public.${table}")
  done
  joined="$(printf ' union all %s' "${parts[@]}")"
  printf 'select t from (%s) s where c > 0 order by t' "${joined# union all }"
}

restore_main() {
  local archive="${1:-}"
  local database_url="${2:-}"
  if [ -z "${archive}" ] || [ -z "${database_url}" ]; then
    echo "usage: restore.sh <archive> <database-url>" >&2
    return 2
  fi
  if [ ! -f "${archive}" ]; then
    echo "[restore] archive not found: ${archive}" >&2
    return 2
  fi
  : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"

  local workdir
  workdir="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '${workdir}'" EXIT

  local dump="${workdir}/dump.sql"
  echo "[restore] decrypting ${archive}"
  decrypt_stream <"${archive}" | gzip -dc >"${dump}"

  # Même contrat qu'à la sauvegarde : on refuse de restaurer une archive dont
  # le jeu de tables n'est pas exactement celui attendu.
  assert_dump_tables "${dump}"
  echo "[restore] archive holds the ${#USER_TABLES[@]} user tables, no catalogue table"

  # 1. Le schéma doit être là. Il vient des migrations, jamais de l'archive.
  local probe
  probe="$(psql "${database_url}" -tAc "select to_regclass('public.holdings') is not null")"
  if [ "${probe}" != "t" ]; then
    cat >&2 <<'EOF'
[restore] the target database has no schema yet.
          The archive carries data only — apply the migrations first:
            docker compose -f docker-compose.example.yml up -d web
          (the app container migrates before serving), or, outside Docker:
            DATABASE_URL=<url> pnpm db:migrate
EOF
    return 1
  fi

  # 2. Base vierge, sinon on s'arrête : empiler une archive sur des données
  #    existantes produirait des doublons impossibles à démêler.
  local populated
  populated="$(psql "${database_url}" -tAc "$(non_empty_tables_query)" | tr -d ' ' | tr '\n' ' ')"
  populated="${populated% }"
  if [ -n "${populated}" ]; then
    if [ "${RESTORE_TRUNCATE:-}" = "1" ]; then
      echo "[restore] RESTORE_TRUNCATE=1 — emptying: ${populated}"
      local joined
      joined="$(printf ', public.%s' "${USER_TABLES[@]}")"
      psql "${database_url}" -v ON_ERROR_STOP=1 -q -c "truncate ${joined#, } cascade"
    else
      echo "[restore] refusing to restore: these tables already hold rows: ${populated}" >&2
      echo "[restore] restore onto an empty database, or set RESTORE_TRUNCATE=1 to replace them." >&2
      return 1
    fi
  fi

  # 3. Réinjection, en une seule transaction : tout ou rien.
  echo "[restore] loading user data"
  {
    echo 'BEGIN;'
    # Désactive les déclencheurs de clé étrangère le temps du chargement : le
    # catalogue est encore vide (voir l'en-tête). Transactionnel, donc rétabli
    # à la fin quoi qu'il arrive.
    echo "SET session_replication_role = 'replica';"
    cat "${dump}"
    echo 'COMMIT;'
  } | psql "${database_url}" -v ON_ERROR_STOP=1 -q

  local table count
  for table in "${USER_TABLES[@]}"; do
    count="$(psql "${database_url}" -tAc "select count(*) from public.${table}")"
    printf '[restore] %-20s %s rows\n' "${table}" "${count}"
  done

  cat <<'EOF'
[restore] user data is back.

Next, and it is not optional — the catalogue is empty:

  1. pnpm import:bulk
     (in Docker: docker compose -f docker-compose.example.yml exec worker \
        node apps/worker/src/index.ts --run-now, then watch the worker logs)

  2. Check that every holding still points at a card the catalogue knows.
     A card removed from Scryfall since the backup would show up here:

       select count(*) from holdings h
         left join cards c on c.id = h.card_id
        where c.id is null;

     Foreign keys were not enforced during the load, so this query — not the
     database — is what tells you the restore is whole.
EOF
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  restore_main "$@"
fi
