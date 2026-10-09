// Code Postgres `unique_violation`. Depuis drizzle-orm 0.44, l'erreur du
// driver arrive enveloppée dans un `DrizzleQueryError` : le code se lit sur
// la chaîne des `cause`, pas sur l'erreur levée elle-même.
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  while (typeof current === 'object' && current !== null) {
    if ((current as { code?: unknown }).code === '23505') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}
