// La page « Configuration » est construite depuis .env.example : ces tests
// figent le format que le parseur attend, et vérifient que le vrai fichier
// le respecte encore.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parseEnvExample } from '../src/lib/env-example.ts'

const sample = `# Sections:
#   1. Development   — running the app
#   2. Production    — self-hosting

# =============================================================================
# 1. Development
# =============================================================================

# [required] Secret that signs session cookies. Create it once
# and keep it.
#   openssl rand -base64 32
AUTH_SECRET=

# [optional] Interface and port. Defaults: 127.0.0.1 and 3000.
# WEB_BIND=127.0.0.1
# WEB_PORT=3000

# =============================================================================
# 2. Backup (deploy/backup.sh)
# =============================================================================
#
# Not read by docker compose. DATABASE_URL must point to:
#   postgres://user:pass@127.0.0.1:5432/db

# [required for backups] Destination of the archive.
BACKUP_DEST=
`

describe('docs/env-example — parseEnvExample', () => {
  const sections = parseEnvExample(sample)

  it('reads the framed section titles, not the legend, and drops the parenthesis', () => {
    expect(sections.map((s) => s.title)).toEqual(['Development', 'Backup'])
  })

  it('joins the comment block into one description and keeps indented lines as code', () => {
    expect(sections[0].entries[0]).toEqual({
      names: ['AUTH_SECRET'],
      status: 'required',
      description: 'Secret that signs session cookies. Create it once and keep it.',
      code: ['openssl rand -base64 32'],
    })
  })

  it('groups consecutive variables, commented or not, under one entry', () => {
    expect(sections[0].entries[1].names).toEqual(['WEB_BIND', 'WEB_PORT'])
    expect(sections[0].entries[1].status).toBe('optional')
  })

  it('keeps a comment without status as the section intro', () => {
    expect(sections[1].intro).toEqual(['Not read by docker compose. DATABASE_URL must point to:'])
    expect(sections[1].introCode).toEqual(['postgres://user:pass@127.0.0.1:5432/db'])
    expect(sections[1].entries[0].status).toBe('required for backups')
  })

  it('finds every variable of the real .env.example', () => {
    const real = readFileSync(fileURLToPath(new URL('../../../.env.example', import.meta.url)), 'utf8')
    const documented = parseEnvExample(real).flatMap((s) => s.entries.flatMap((e) => e.names))
    const declared = [...real.matchAll(/^#?\s?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1])
    expect(documented.sort()).toEqual([...new Set(declared)].sort())
  })
})
