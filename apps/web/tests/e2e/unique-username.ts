// Username unique pour un compte de test, conforme à `usernameSchema`
// (lib/username.ts : `/^[a-z0-9_-]{3,20}$/`).
//
// Chaque spec construisait le sien en `${prefix}${Date.now()}${Math.floor(
// Math.random() * 1000)}` : `Date.now()` fait 13 chiffres, si bien que le
// plus court des préfixes utilisés (`e2ecoll`, 7) donnait déjà 21 à 23
// caractères. Le formulaire d'onboarding garde alors `Continue` désactivé
// (`isValid` est faux, app/(app)/onboarding/username/username-form.tsx), la
// connexion n'aboutit jamais et **toute** la suite e2e échoue au même point.
//
// Base 36 plutôt que décimal : l'horodatage tient en 8 caractères au lieu de
// 13, et l'alphabet `[0-9a-z]` reste dans celui du schéma. Le préfixe est
// tronqué à 10 pour que le total soit borné quel qu'il soit.
export function uniqueUsername(prefix: string): string {
  const stamp = Date.now().toString(36)
  const salt = Math.random().toString(36).slice(2, 4).padEnd(2, '0')
  return `${prefix.toLowerCase().slice(0, 10)}${stamp}${salt}`
}
