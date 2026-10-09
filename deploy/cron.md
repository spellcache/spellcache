# Entrées cron du VPS

Deux tâches périodiques vivent sur l'hôte, pas dans les conteneurs : le cron du
worker et la sauvegarde. Elles supposent que le dépôt
est déployé dans `/srv/spellcache` et que `/srv/spellcache/.env` est rempli (voir
`.env.example`).

## Installation

```bash
sudo crontab -e
```

```cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 03:15 — nuit d'import + revalorisation.
15 3 * * * cd /srv/spellcache && docker compose -f docker-compose.example.yml exec -T worker node apps/worker/src/index.ts --run-now >> /var/log/spellcache-nightly.log 2>&1

# 04:30 — sauvegarde des tables utilisateur, chiffrée, hors du VPS.
30 4 * * * cd /srv/spellcache && set -a && source ./.env && set +a && ./deploy/backup.sh "$BACKUP_DEST" >> /var/log/spellcache-backup.log 2>&1
```

`cron` n'hérite d'aucun environnement : la ligne de sauvegarde charge donc
`.env` elle-même (`BACKUP_DEST`, `BACKUP_PASSPHRASE`,
`BACKUP_RETENTION_DAYS`, `DATABASE_URL`). Sans cela, `backup.sh` s'arrête au
premier `:?` avec un message explicite plutôt que d'écrire une archive vide.

## Accès de `backup.sh` à la base

`backup.sh` s'exécute sur l'hôte : il lui faut `openssl`, `gzip`, et — pour une
destination `ssh://` — la clé SSH de l'hôte. Il lui faut donc aussi `pg_dump`
et un `DATABASE_URL` joignable depuis l'hôte :

```bash
sudo apt install postgresql-client-17
```

`docker-compose.example.yml` publie déjà Postgres sur `127.0.0.1:5432`, la boucle
locale du VPS et rien d'autre. Le `.env` de l'hôte porte donc :

```
DATABASE_URL=postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@127.0.0.1:5432/<POSTGRES_DB>
```

## Pourquoi deux déclencheurs pour la même nuit

Le conteneur `worker` porte déjà un ordonnanceur interne
(`apps/worker/src/scheduler.ts`, réglé par `WORKER_NIGHTLY_AT` et `WORKER_TIMEZONE`).
L'entrée cron ci-dessus est un second déclencheur, utile quand le conteneur
vient d'être redémarré hors de sa fenêtre, ou pour relancer une nuit à la main.

Les deux prennent le même verrou Redis (`spellcache:worker:lock:nightly`,
`SET NX PX`) avant de mettre le job en file : **le second sort proprement en
journalisant qu'il a été ignoré**, il ne lance pas un deuxième import.

```
[worker] nightly run skipped: another trigger holds the "nightly" lock
[worker] nightly trigger ignored, nothing queued
```

Le verrou expire au bout de 6 heures. Pour forcer une relance dans la même
nuit :

```bash
docker compose -f docker-compose.example.yml exec redis valkey-cli DEL spellcache:worker:lock:nightly
```

## Vérifier

```bash
# la nuit dernière a-t-elle tourné ?
docker compose -f docker-compose.example.yml logs --since 24h worker | grep nightly

# les dernières lignes d'import (table import_runs, écrite par le job lui-même)
docker compose -f docker-compose.example.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'select started_at, finished_at, status from import_runs order by started_at desc limit 5'

# les archives présentes à la destination, et leur âge
ls -l --time-style=long-iso /chemin/de/BACKUP_DEST
```
