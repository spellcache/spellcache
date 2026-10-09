// Libellés affichés des rôles de membre — une seule table pour toute
// l'interface. Les valeurs en base restent `owner` / `editor` / `viewer`
// (packages/db/src/schema.ts) ; seuls les mots changent (choix produit) : Contributor
// écrit, Guest lit seulement.
import type { MemberRole } from '@spellcache/db/schema'

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  editor: 'Contributor',
  viewer: 'Guest',
}

export function roleLabel(role: MemberRole): string {
  return ROLE_LABELS[role]
}
