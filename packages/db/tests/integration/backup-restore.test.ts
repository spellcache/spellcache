// Aller-retour sauvegarde → restauration : une sauvegarde jamais restaurée
// n'est pas une sauvegarde.
//
// Trois blocs, avec des exigences d'environnement différentes — délibérément,
// pour qu'un maximum de ce fichier s'exécute partout :
//
//   1. « contrat des tables » : lit packages/db/src/schema.ts et la liste de deploy/backup.sh
//      et les compare. Ne demande que `bash`. C'est le garde-fou contre la
//      dérive : une douzième table utilisateur ajoutée par une feature future et
//      oubliée de la sauvegarde échoue ici, pas au moment de la restauration.
//   2. « rotation, chiffrement, inspection » : exécute les fonctions du script
//      sur de vrais fichiers. Ne demande que `bash` et `openssl`.
//   3. « aller-retour complet » : base peuplée → archive → base vierge → import
//      de catalogue → comparaison ligne pour ligne. Demande Postgres
//      (`TEST_DATABASE_URL`, voir packages/db/testing/global-setup.ts) ainsi que
//      `pg_dump` et `psql`.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))
const dbPackageDir = fileURLToPath(new URL('../..', import.meta.url))

function bash(script: string): string {
  return execFileSync('bash', ['-c', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
}

function hasCommand(command: string): boolean {
  try {
    execFileSync('bash', ['-c', `command -v ${command}`], { cwd: repoRoot, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const HAS_BASH = ((): boolean => {
  try {
    execFileSync('bash', ['-c', 'true'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const HAS_OPENSSL = HAS_BASH && hasCommand('openssl')
const HAS_PG_TOOLS = HAS_BASH && hasCommand('pg_dump') && hasCommand('psql')

// Les quatre tables du catalogue, exclues de la sauvegarde. Toute table de
// packages/db/src/schema.ts qui n'est ni ici ni dans `deploy/backup.sh` fait
// échouer le test — c'est le but.
const CATALOGUE_TABLES = ['cards', 'sets', 'card_prices', 'import_runs']

function tablesDeclaredInSchema(): string[] {
  const source = readFileSync(new URL('../../src/schema.ts', import.meta.url), 'utf8')
  return [...source.matchAll(/pgTable\(\s*'([a-z_]+)'/g)].map((match) => match[1]!).sort()
}

function tablesBackedUp(): string[] {
  return bash('source deploy/backup.sh && user_tables')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort()
}

describe.skipIf(!HAS_BASH)('deploy/backup.sh, contrat des tables', () => {
  it('backs up exactly the twelve user tables', () => {
    expect(tablesBackedUp()).toEqual(
      [
        'accounts',
        'collection_members',
        'collections',
        'container_stats',
        'containers',
        'deck_folders',
        'holdings',
        'import_lists',
        'sessions',
        'site_settings',
        'users',
        'verification_tokens',
      ].sort(),
    )
  })

  it('covers every user table of packages/db/src/schema.ts, catalogue tables excepted', () => {
    // La vérité est le schéma, pas une liste figée : si une feature ajoute
    // une table utilisateur sans l'ajouter à la sauvegarde, elle apparaît ici.
    const declared = tablesDeclaredInSchema()
    const expected = declared.filter((table) => !CATALOGUE_TABLES.includes(table))
    expect(tablesBackedUp()).toEqual(expected)
    // Et le schéma n'a pas perdu de table de catalogue en route.
    expect(declared).toEqual([...expected, ...CATALOGUE_TABLES].sort())
  })

  it('never backs up a catalogue table', () => {
    const backedUp = tablesBackedUp()
    for (const table of CATALOGUE_TABLES) {
      expect(backedUp).not.toContain(table)
    }
  })

  it('names the archive after the day it was taken', () => {
    expect(bash("source deploy/backup.sh && archive_name '2026-08-29'").trim()).toBe(
      '2026-08-29-spellcache-user.sql.gz.enc',
    )
  })
})

describe.skipIf(!HAS_OPENSSL)('deploy/backup.sh, rotation et chiffrement', () => {
  it('deletes archives older than the retention window and keeps the rest', () => {
    // Quatre archives d'âges différents, plus un fichier
    // étranger : la rotation ne doit toucher ni les récentes ni ce qui n'est
    // pas à elle.
    const remaining = bash(`
      set -euo pipefail
      source deploy/backup.sh
      dir=$(mktemp -d)
      touch -d '40 days ago' "$dir/2026-07-20-spellcache-user.sql.gz.enc"
      touch -d '31 days ago' "$dir/2026-07-29-spellcache-user.sql.gz.enc"
      touch -d '29 days ago' "$dir/2026-07-31-spellcache-user.sql.gz.enc"
      touch -d '1 day ago'   "$dir/2026-08-28-spellcache-user.sql.gz.enc"
      touch -d '90 days ago' "$dir/do-not-touch.txt"
      rotate_local "$dir" 30 >/dev/null
      ls "$dir" | sort
      rm -rf "$dir"
    `)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    expect(remaining).toEqual([
      '2026-07-31-spellcache-user.sql.gz.enc',
      '2026-08-28-spellcache-user.sql.gz.enc',
      'do-not-touch.txt',
    ])
  })

  it('encrypts the archive and reads it back only with the passphrase', () => {
    const output = bash(`
      set -euo pipefail
      source deploy/backup.sh
      dir=$(mktemp -d)
      export BACKUP_PASSPHRASE='correct horse battery staple'
      printf 'the payload' | gzip -9 -c | encrypt_stream > "$dir/a.enc"
      echo "header=$(head -c 6 "$dir/a.enc")"
      echo "plaintext_leaked=$(grep -c 'the payload' "$dir/a.enc" || true)"
      echo "roundtrip=$(decrypt_stream < "$dir/a.enc" | gzip -dc)"
      if BACKUP_PASSPHRASE='wrong' decrypt_stream < "$dir/a.enc" >/dev/null 2>&1; then
        echo 'wrong_passphrase=accepted'
      else
        echo 'wrong_passphrase=rejected'
      fi
      rm -rf "$dir"
    `)

    expect(output).toContain('header=Salted')
    expect(output).toContain('plaintext_leaked=0')
    expect(output).toContain('roundtrip=the payload')
    expect(output).toContain('wrong_passphrase=rejected')
  })

  it('lists the tables of a dump without being fooled by COPY data', () => {
    // Un nom de deck qui ressemble à un ordre `COPY` ne doit pas fabriquer une
    // table fantôme : l'automate suit les blocs de données, il ne les lit pas.
    const tables = bash(`
      set -euo pipefail
      source deploy/backup.sh
      dir=$(mktemp -d)
      {
        echo 'SET statement_timeout = 0;'
        echo 'COPY public.users (id, email) FROM stdin;'
        printf '1\\tCOPY public.cards (id) FROM stdin;\\n'
        echo '\\.'
        echo 'COPY public.holdings (id) FROM stdin;'
        echo '\\.'
      } > "$dir/dump.sql"
      list_dump_tables < "$dir/dump.sql"
      rm -rf "$dir"
    `)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    expect(tables).toEqual(['holdings', 'users'])
  })

  it('refuses a dump that is missing a user table', () => {
    const verdict = bash(`
      source deploy/backup.sh
      dir=$(mktemp -d)
      { echo 'COPY public.users (id) FROM stdin;'; echo '\\.'; } > "$dir/dump.sql"
      if assert_dump_tables "$dir/dump.sql" >/dev/null 2>&1; then echo accepted; else echo rejected; fi
      rm -rf "$dir"
    `).trim()

    expect(verdict).toBe('rejected')
  })

  it('refuses a dump that carries a catalogue table', () => {
    const verdict = bash(`
      source deploy/backup.sh
      dir=$(mktemp -d)
      {
        for t in $(user_tables) cards; do
          echo "COPY public.$t (id) FROM stdin;"
          echo '\\.'
        done
      } > "$dir/dump.sql"
      if assert_dump_tables "$dir/dump.sql" >/dev/null 2>&1; then echo accepted; else echo rejected; fi
      rm -rf "$dir"
    `).trim()

    expect(verdict).toBe('rejected')
  })

  it('rejects a destination that is neither file:// nor ssh://', () => {
    const verdict = bash(`
      source deploy/backup.sh
      if ship_archive /dev/null 's3://bucket/path' 30 >/dev/null 2>&1; then echo accepted; else echo rejected; fi
    `).trim()

    expect(verdict).toBe('rejected')
  })
})

describe.skipIf(!HAS_PG_TOOLS || !process.env.TEST_DATABASE_URL)(
  'aller-retour sauvegarde / restauration',
  () => {
    // Le corps d'un `describe.skipIf` est tout de même évalué à la collecte :
    // sans ce repli, `new URL(undefined)` ferait échouer le fichier entier —
    // donc aussi les deux blocs précédents, qui eux s'exécutent partout.
    const adminUrl =
      process.env.TEST_DATABASE_URL ?? 'postgres://unused:unused@127.0.0.1:5433/unused'
    const passphrase = 'round-trip-passphrase'

    // Deux bases neuves, jamais la base partagée des autres tests
    // d'intégration : la sauvegarde emporte TOUTES les lignes de la base, la
    // comparaison ligne pour ligne serait donc faussée par un autre fichier de
    // test qui écrirait au même moment (Vitest exécute les fichiers en
    // parallèle). `adminUrl` ne sert qu'à créer et supprimer ces deux bases.
    const stamp = Date.now()
    const sourceDbName = `spellcache_backup_src_${stamp}`
    const restoreDbName = `spellcache_backup_dst_${stamp}`
    const sourceUrl = new URL(adminUrl)
    sourceUrl.pathname = `/${sourceDbName}`
    const targetUrl = new URL(adminUrl)
    targetUrl.pathname = `/${restoreDbName}`

    let admin: Client
    let source: Client
    let target: Client
    let workdir: string

    // Jeu de données : deux comptes, une collection partagée, un dossier, trois
    // containers, six holdings, un stat, une ligne d'import — et un catalogue
    // (sets + cards + card_prices) qui ne doit PAS suivre.
    const cardIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]

    async function seedCatalogue(client: Client): Promise<void> {
      await client.query(
        `INSERT INTO sets (code, name, card_count) VALUES ('lea', 'Limited Edition Alpha', 3)
         ON CONFLICT (code) DO NOTHING`,
      )
      await client.query(
        `INSERT INTO cards (id, oracle_id, name, set_code, collector_number, rarity, cmc, type_line, colors, color_identity, finishes, legalities)
         SELECT id, id, id::text, 'lea', id::text, 'common', 0, 'Creature', '{}', '{}', '{nonfoil,foil}', '{}'
         FROM unnest($1::uuid[]) AS id
         ON CONFLICT (id) DO NOTHING`,
        [cardIds],
      )
      await client.query(
        `INSERT INTO card_prices (card_id, day, usd, usd_foil, eur, eur_foil)
         SELECT id, current_date, '1.00', '2.00', '0.90', '1.80' FROM unnest($1::uuid[]) AS id
         ON CONFLICT (card_id, day) DO NOTHING`,
        [cardIds],
      )
    }

    async function seedUserData(client: Client): Promise<void> {
      const owner = (
        await client.query<{ id: string }>(
          `INSERT INTO users (email, username) VALUES ('owner@example.test', 'owner') RETURNING id`,
        )
      ).rows[0]!.id
      const editor = (
        await client.query<{ id: string }>(
          `INSERT INTO users (email, username) VALUES ('editor@example.test', 'editor') RETURNING id`,
        )
      ).rows[0]!.id
      const collection = (
        await client.query<{ id: string }>(
          `INSERT INTO collections (name) VALUES ('Shared collection') RETURNING id`,
        )
      ).rows[0]!.id

      await client.query(
        `INSERT INTO collection_members (collection_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'editor')`,
        [collection, owner, editor],
      )
      const folder = (
        await client.query<{ id: string }>(
          `INSERT INTO deck_folders (collection_id, name, position) VALUES ($1, 'Commander', 0) RETURNING id`,
          [collection],
        )
      ).rows[0]!.id
      const root = (
        await client.query<{ id: string }>(
          `INSERT INTO containers (collection_id, kind, name) VALUES ($1, 'collection', 'All collection') RETURNING id`,
          [collection],
        )
      ).rows[0]!.id
      const binder = (
        await client.query<{ id: string }>(
          `INSERT INTO containers (collection_id, kind, name, cover_card_id) VALUES ($1, 'binder', 'Rares', $2) RETURNING id`,
          [collection, cardIds[0]],
        )
      ).rows[0]!.id
      const deck = (
        await client.query<{ id: string }>(
          `INSERT INTO containers (collection_id, kind, name, folder_id, deck_state, format) VALUES ($1, 'deck', 'Mono red', $2, 'built', 'commander') RETURNING id`,
          [collection, folder],
        )
      ).rows[0]!.id

      for (const container of [root, binder, deck]) {
        await client.query(
          `INSERT INTO holdings (container_id, card_id, qty, finish) SELECT $1::uuid, id, 2, 'nonfoil' FROM unnest($2::uuid[]) AS id`,
          [container, cardIds],
        )
      }
      await client.query(
        `INSERT INTO container_stats (container_id, card_count, unique_count, value_usd_minor, value_eur_minor)
         VALUES ($1, 6, 3, 600, 540)`,
        [root],
      )
      await client.query(
        `INSERT INTO import_lists (container_id, user_id, line_count) VALUES ($1, $2, 3)`,
        [deck, owner],
      )
      await client.query(
        `INSERT INTO accounts (user_id, type, provider, provider_account_id) VALUES ($1, 'email', 'resend', 'owner@example.test')`,
        [owner],
      )
      await client.query(
        `INSERT INTO sessions (session_token, user_id, expires) VALUES ('session-token-1', $1, now() + interval '30 days')`,
        [owner],
      )
      await client.query(
        `INSERT INTO verification_tokens (identifier, token, expires) VALUES ('owner@example.test', 'verify-1', now() + interval '1 day')`,
      )
    }

    function migrate(url: URL): void {
      // Le schéma vient des migrations versionnées, jamais de l'archive :
      // c'est exactement ce que fait un VPS neuf au premier démarrage.
      execFileSync('pnpm', ['exec', 'drizzle-kit', 'migrate'], {
        cwd: dbPackageDir,
        env: { ...process.env, DATABASE_URL: url.toString() },
        stdio: 'ignore',
      })
    }

    beforeAll(async () => {
      admin = new Client({ connectionString: adminUrl })
      await admin.connect()
      await admin.query(`CREATE DATABASE ${sourceDbName}`)
      await admin.query(`CREATE DATABASE ${restoreDbName}`)
      migrate(sourceUrl)
      migrate(targetUrl)

      source = new Client({ connectionString: sourceUrl.toString() })
      await source.connect()
      await seedCatalogue(source)
      await seedUserData(source)

      target = new Client({ connectionString: targetUrl.toString() })
      await target.connect()

      workdir = bash('mktemp -d').trim()
    }, 180_000)

    afterAll(async () => {
      if (target) await target.end()
      if (source) await source.end()
      if (admin) {
        await admin.query(`DROP DATABASE IF EXISTS ${sourceDbName} WITH (FORCE)`)
        await admin.query(`DROP DATABASE IF EXISTS ${restoreDbName} WITH (FORCE)`)
        await admin.end()
      }
      if (workdir) bash(`rm -rf '${workdir}'`)
    })

    async function rows(client: Client, sql: string): Promise<unknown[]> {
      return (await client.query(sql)).rows
    }

    it('writes an encrypted archive that holds the user tables and no catalogue table', () => {
      // Vérifié en listant les tables de l'archive déchiffrée — la base source
      // contient pourtant bien un catalogue.
      const output = bash(`
        set -euo pipefail
        export DATABASE_URL='${sourceUrl.toString()}'
        export BACKUP_PASSPHRASE='${passphrase}'
        bash deploy/backup.sh 'file://${workdir}/dest' >/dev/null
        archive=$(ls ${workdir}/dest/*-spellcache-user.sql.gz.enc)
        echo "archive=$archive"
        source deploy/backup.sh
        decrypt_stream < "$archive" | gzip -dc | list_dump_tables
      `)

      const archive = output.match(/archive=(.+)/)![1]!.trim()
      expect(archive).toMatch(/\d{4}-\d{2}-\d{2}-spellcache-user\.sql\.gz\.enc$/)

      const tables = output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('archive='))
      expect(tables).toEqual(tablesBackedUp())
      for (const catalogueTable of CATALOGUE_TABLES) {
        expect(tables).not.toContain(catalogueTable)
      }
    }, 120_000)

    it('restores the user data row for row onto a virgin database', async () => {
      // Restauration sur base vierge, puis import du catalogue, puis
      // comparaison.
      const before = {
        collections: await rows(source, 'select * from collections order by id'),
        members: await rows(
          source,
          'select * from collection_members order by collection_id, user_id',
        ),
        containers: await rows(source, 'select * from containers order by id'),
        holdings: await rows(source, 'select * from holdings order by id'),
      }

      bash(`
        set -euo pipefail
        export BACKUP_PASSPHRASE='${passphrase}'
        archive=$(ls ${workdir}/dest/*-spellcache-user.sql.gz.enc)
        bash deploy/restore.sh "$archive" '${targetUrl.toString()}' >/dev/null
      `)

      // Le catalogue se réimporte : `pnpm import:bulk` téléchargerait 2 Go
      // depuis Scryfall, on rejoue donc ici les mêmes lignes que celles que
      // l'import reconstruirait — c'est ce que la restauration attend de lui.
      await seedCatalogue(target)

      expect(await rows(target, 'select * from collections order by id')).toEqual(
        before.collections,
      )
      expect(
        await rows(target, 'select * from collection_members order by collection_id, user_id'),
      ).toEqual(before.members)
      expect(await rows(target, 'select * from containers order by id')).toEqual(before.containers)
      expect(await rows(target, 'select * from holdings order by id')).toEqual(before.holdings)

      // Le catalogue n'était PAS dans l'archive : sans le réimport ci-dessus,
      // ces lignes n'existeraient pas. On vérifie donc que la restauration ne
      // l'a pas apporté elle-même.
      const dangling = await rows(
        target,
        'select h.id from holdings h left join cards c on c.id = h.card_id where c.id is null',
      )
      expect(dangling).toEqual([])
    }, 120_000)

    it('refuses to restore onto a database that already holds user rows', () => {
      const verdict = bash(`
        export BACKUP_PASSPHRASE='${passphrase}'
        archive=$(ls ${workdir}/dest/*-spellcache-user.sql.gz.enc)
        if bash deploy/restore.sh "$archive" '${targetUrl.toString()}' >/dev/null 2>&1; then
          echo accepted
        else
          echo rejected
        fi
      `).trim()

      // Sans ce refus, une seconde restauration empilerait des doublons de
      // toutes les tables sans le dire.
      expect(verdict).toBe('rejected')
    }, 120_000)
  },
)
