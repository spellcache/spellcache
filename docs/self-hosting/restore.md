---
title: Restore
description: Restore a spellcache backup on a fresh server, step by step.
---

This page stands on its own: it assumes an archive, its passphrase, and a fresh
server where [Installation](../installation/) was followed up to **Start**.

The archive holds **data only**: the schema comes from the versioned
migrations and the catalogue is re-imported. Follow the steps in order.

## 1. Copy the archive and set the passphrase

```bash
cd /srv/spellcache
scp <archive>-spellcache-user.sql.gz.enc <server>:/srv/spellcache/   # from your machine
set -a && source ./.env && set +a                                     # on the server
export BACKUP_PASSPHRASE='…'   # AFTER sourcing .env: the archive's passphrase, not the new one
```

Order matters: a fresh server's `.env` has its own `BACKUP_PASSPHRASE`.
Sourced second, it would overwrite the archive's and decryption would fail.

## 2. Stop everything that writes to the database

```bash
docker compose -f docker-compose.example.yml stop web worker
docker compose -f docker-compose.example.yml up -d postgres
```

## 3. Start from an empty, migrated database

On a fresh database, applying the migrations is all there is to do:

```bash
psql "$DATABASE_URL" -c 'select 1'                         # must answer
docker compose -f docker-compose.example.yml up -d web     # applies the migrations
docker compose -f docker-compose.example.yml stop web
```

## 4. Restore

```bash
./deploy/restore.sh ./<archive>-spellcache-user.sql.gz.enc "$DATABASE_URL"
```

The script:

- decrypts the archive and checks that it holds exactly the user tables and no
  catalogue table;
- refuses to continue if the schema is missing or the tables already hold rows
  (set `RESTORE_TRUNCATE=1` to replace them on purpose);
- loads everything in one transaction, with foreign keys disabled while
  loading, since `holdings.card_id` points to a catalogue that is still empty;
- prints the number of restored rows per table.

## 5. Re-import the catalogue

Without it, the app shows cards with no name and no price.

```bash
docker compose -f docker-compose.example.yml up -d
docker compose -f docker-compose.example.yml exec -T worker node apps/worker/src/index.ts --run-now
docker compose -f docker-compose.example.yml logs -f worker
```

## 6. Check that the restore is complete

```bash
psql "$DATABASE_URL" -c 'select count(*) from holdings h
  left join cards c on c.id = h.card_id where c.id is null;'
```

The result must be `0`. Foreign keys are not re-validated after loading, so
this query tells whether every owned card still exists in the catalogue. A
non-zero result means cards were removed from Scryfall since the backup; drop
`count(*)` from the query to list them.

Finally, sign in, open your collection, and check the card count and value.
