---
title: Backup
description: Encrypted backups of the user data, and where to send them.
---

`deploy/backup.sh` writes an **encrypted** archive of the user tables, and
only those:

```
users  accounts  sessions  verification_tokens  collections  collection_members
containers  holdings  container_stats  deck_folders  import_lists  trades
trade_lines  site_settings
```

The catalogue (`cards`, `sets`, `card_prices`, `import_runs`) is **not** backed
up: it is rebuilt with one command, and including it would make the archive a
hundred times larger. The script refuses to encrypt a dump whose table set is
not exactly that one.

## Run it by hand

```bash
cd /srv/spellcache
set -a && source ./.env && set +a
./deploy/backup.sh "$BACKUP_DEST"
```

Output: `<YYYY-MM-DD>-spellcache-user.sql.gz.enc` at the destination, then
rotation: archives older than `BACKUP_RETENTION_DAYS` days (30 by default) are
deleted, nothing else is touched.

To run it every night, see [Scheduled tasks](../scheduled-tasks/).

## Destinations

| Destination URI | Effect |
|---|---|
| `file:///absolute/path` | local copy or mounted remote disk, rotation with `find` |
| `ssh://user@host:/path` | copy with `scp`, rotation over `ssh` |

:::danger
Keep `BACKUP_PASSPHRASE` somewhere else than the server. An archive cannot be
restored without it.
:::

A backup you have never restored is a guess: try the [restore](../restore/) on
a spare machine once.
