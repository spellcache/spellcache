// Équivalent de `grep -riE "password|bcrypt|argon2" app lib db`, qui ne doit
// retourner aucune occurrence — implémenté en pur Node plutôt qu'un
// appel shell à `grep`, indisponible de façon fiable sur toutes les plateformes.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PATTERN = /password|bcrypt|argon2/i
const ROOTS = ['app', 'lib', '../../packages/db/src']

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) {
      files.push(...collectFiles(fullPath))
    } else {
      files.push(fullPath)
    }
  }

  return files
}

describe('no password-based authentication (docs/development.md)', () => {
  it.each(ROOTS)('%s/ contains no password/bcrypt/argon2 reference', (root) => {
    const offenders = collectFiles(join(process.cwd(), root)).filter((file) =>
      PATTERN.test(readFileSync(file, 'utf-8')),
    )

    expect(offenders).toEqual([])
  })
})
