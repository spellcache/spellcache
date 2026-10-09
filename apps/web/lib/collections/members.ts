// Ajout, retrait, changement de rôle. Toujours au travers de
// `collection_members` — la même table
// que `lib/collections/authorize.ts` lit, pas un second chemin
// d'autorisation (docs/development.md).
//
// Qui peut gérer les membres : l'écran Settings (« they get read and
// write access to everything in the collection ») décrit l'accès au
// *contenu* de la collection, déjà couvert en entier par
// `requireContainerAccess` pour `owner` comme pour `editor` — elle ne dit
// rien de l'administration de la liste des membres. Sans restriction ici, le
// couple de rôles `owner|editor` ne porte aucune différence de privilège
// applicable, et l'invariant du dernier `owner` est
// contournable en deux appels : un `editor` s'auto-promeut `owner` via
// `changeMemberRole`, puis retire l'`owner` d'origine (`countOwners` vaut
// alors 2, l'invariant ne se déclenche pas). La gestion des membres —
// ajout, retrait, changement de rôle — est donc réservée aux `owner` :
// c'est la règle la plus étroite qui rend le rôle `owner` non
// auto-attribuable par un `editor` et empêche ce contournement.
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import { collectionMembers, collections, users, type MemberRole } from '@spellcache/db/schema'
import { ContainerAccessError } from '@/lib/collections/authorize'
import { db } from '@spellcache/db'
import { isUniqueViolation } from '@spellcache/db/errors'

export interface MemberRow {
  userId: string
  username: string
  role: MemberRole
}

export interface MemberCandidate {
  id: string
  username: string
}

export type AddMemberError = 'not_found' | 'already_member'

// Un seul `owner` par collection : les rôles qu'un ajout ou un changement
// de rôle peut attribuer. La propriété ne change de main que par
// `transferOwnership`.
export type GrantableRole = Exclude<MemberRole, 'owner'>
export type RemoveMemberError = 'last_owner'
export type LeaveCollectionError = 'last_owner'
export type TransferOwnershipError = 'not_found'

async function assertMember(userId: string, collectionId: string): Promise<void> {
  const [row] = await db
    .select({ userId: collectionMembers.userId })
    .from(collectionMembers)
    .where(
      and(eq(collectionMembers.collectionId, collectionId), eq(collectionMembers.userId, userId)),
    )
    .limit(1)
  if (!row) {
    throw new ContainerAccessError(`User ${userId} has no access to collection ${collectionId}.`)
  }
}

// Réservé aux fonctions qui gèrent la liste des membres (`addMember`,
// `removeMember`, `changeMemberRole`) : seul un `owner` peut y toucher.
// Même erreur (`ContainerAccessError`) qu'un compte non membre — les deux
// cas remontent en `forbidden` côté Server Action, sans exposer si l'acteur
// est un `editor` ou un étranger.
async function assertOwner(userId: string, collectionId: string): Promise<void> {
  const [row] = await db
    .select({ role: collectionMembers.role })
    .from(collectionMembers)
    .where(
      and(eq(collectionMembers.collectionId, collectionId), eq(collectionMembers.userId, userId)),
    )
    .limit(1)
  if (!row || row.role !== 'owner') {
    throw new ContainerAccessError(
      `User ${userId} is not an owner of collection ${collectionId}.`,
    )
  }
}

async function countOwners(collectionId: string): Promise<number> {
  const rows = await db
    .select({ userId: collectionMembers.userId })
    .from(collectionMembers)
    .where(and(eq(collectionMembers.collectionId, collectionId), eq(collectionMembers.role, 'owner')))
  return rows.length
}

export async function listMembers(actingUserId: string, collectionId: string): Promise<MemberRow[]> {
  await assertMember(actingUserId, collectionId)

  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      email: users.email,
      role: collectionMembers.role,
    })
    .from(collectionMembers)
    .innerJoin(users, eq(users.id, collectionMembers.userId))
    .where(eq(collectionMembers.collectionId, collectionId))

  // `username` est non-nul pour tout compte ayant terminé l'onboarding —
  // seul cas où il rejoint une collection.
  return rows.map((row) => ({
    userId: row.userId,
    // Un compte invité par email n'a pas encore choisi son username : on
    // affiche son email jusqu'à sa première connexion.
    username: row.username ?? row.email,
    role: row.role,
  }))
}

export async function addMember(
  actingUserId: string,
  collectionId: string,
  username: string,
  role: GrantableRole = 'editor',
): Promise<{ ok: true; member: MemberRow } | { ok: false; error: AddMemberError }> {
  await assertOwner(actingUserId, collectionId)

  const [target] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.username, username))
    .limit(1)
  if (!target) return { ok: false, error: 'not_found' }

  // Multi-collection : un compte peut appartenir à plusieurs collections —
  // seul un doublon dans CETTE collection est refusé. La clé primaire
  // `(collection_id, user_id)` rattrape un second ajout simultané (23505).
  try {
    await db.insert(collectionMembers).values({ collectionId, userId: target.id, role })
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'already_member' }
    throw error
  }

  return { ok: true, member: { userId: target.id, username: target.username ?? '', role } }
}

export async function removeMember(
  actingUserId: string,
  collectionId: string,
  targetUserId: string,
): Promise<{ ok: true } | { ok: false; error: RemoveMemberError }> {
  await assertOwner(actingUserId, collectionId)

  const [target] = await db
    .select({ role: collectionMembers.role })
    .from(collectionMembers)
    .where(
      and(
        eq(collectionMembers.collectionId, collectionId),
        eq(collectionMembers.userId, targetUserId),
      ),
    )
    .limit(1)
  if (!target) return { ok: true }

  if (target.role === 'owner' && (await countOwners(collectionId)) <= 1) {
    return { ok: false, error: 'last_owner' }
  }

  await db
    .delete(collectionMembers)
    .where(
      and(
        eq(collectionMembers.collectionId, collectionId),
        eq(collectionMembers.userId, targetUserId),
      ),
    )
  return { ok: true }
}

export async function changeMemberRole(
  actingUserId: string,
  collectionId: string,
  targetUserId: string,
  role: GrantableRole,
): Promise<{ ok: true } | { ok: false; error: RemoveMemberError }> {
  await assertOwner(actingUserId, collectionId)

  const [target] = await db
    .select({ role: collectionMembers.role })
    .from(collectionMembers)
    .where(
      and(
        eq(collectionMembers.collectionId, collectionId),
        eq(collectionMembers.userId, targetUserId),
      ),
    )
    .limit(1)
  if (!target) return { ok: true }

  // L'`owner` ne change pas de rôle : il transfère d'abord la propriété
  // (un seul owner par collection — même erreur explicite que le retrait du
  // dernier owner).
  if (target.role === 'owner') {
    return { ok: false, error: 'last_owner' }
  }

  await db
    .update(collectionMembers)
    .set({ role })
    .where(
      and(
        eq(collectionMembers.collectionId, collectionId),
        eq(collectionMembers.userId, targetUserId),
      ),
    )
  return { ok: true }
}

// Combobox « Add a member » :
// les comptes qui ne sont pas encore membres de CETTE collection — qu'ils
// en possèdent une autre ou non (multi-collection). Réservé au
// propriétaire, comme le reste de la gestion des membres (voir
// `assertOwner` ci-dessus) : un `editor` ne doit pas apprendre la liste des
// comptes libres avant même de pouvoir en ajouter un.
export async function listMemberCandidates(
  actingUserId: string,
  collectionId: string,
): Promise<MemberCandidate[]> {
  await assertOwner(actingUserId, collectionId)

  const rows = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .leftJoin(
      collectionMembers,
      and(eq(collectionMembers.userId, users.id), eq(collectionMembers.collectionId, collectionId)),
    )
    // `username` non nul : seul un compte ayant terminé l'onboarding peut
    // rejoindre une collection (même garde que `listMembers` ci-dessus).
    .where(and(isNull(collectionMembers.userId), isNotNull(users.username)))
    .orderBy(asc(users.username))

  return rows.map((row) => ({ id: row.id, username: row.username ?? '' }))
}

// Transfert de propriété : promouvoir la cible **puis**
// rétrograder l'appelant, dans une seule transaction — l'invariant du
// dernier `owner` (`assertOwner`/`countOwners` ci-dessus) interdirait le
// chemin en deux appels séparés (`changeMemberRole` deux fois), la seconde
// écriture retirant le seul `owner` restant tant que la première n'a pas
// encore été validée du point de vue d'une lecture concurrente. À
// l'intérieur de cette transaction les deux comptes sont `owner` un instant,
// l'invariant ne se déclenche donc jamais.
export async function transferOwnership(
  actingUserId: string,
  collectionId: string,
  targetUserId: string,
): Promise<{ ok: true } | { ok: false; error: TransferOwnershipError }> {
  await assertOwner(actingUserId, collectionId)

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ role: collectionMembers.role })
      .from(collectionMembers)
      .where(
        and(eq(collectionMembers.collectionId, collectionId), eq(collectionMembers.userId, targetUserId)),
      )
      .limit(1)
    if (!target) return { ok: false, error: 'not_found' as const }

    await tx
      .update(collectionMembers)
      .set({ role: 'owner' })
      .where(
        and(eq(collectionMembers.collectionId, collectionId), eq(collectionMembers.userId, targetUserId)),
      )
    await tx
      .update(collectionMembers)
      .set({ role: 'editor' })
      .where(
        and(eq(collectionMembers.collectionId, collectionId), eq(collectionMembers.userId, actingUserId)),
      )

    return { ok: true as const }
  })
}

// Départ volontaire : contrairement au reste de ce fichier, pas
// réservé à l'`owner` — c'est un `editor` qui se retire lui-même, jamais un
// second chemin d'autorisation sur le contenu de la collection
// (`assertMember` suffit). Le dernier `owner` ne peut pas partir sans
// transférer d'abord (même invariant que `removeMember`/`changeMemberRole`).
// Un compte qui vient de quitter n'a plus de ligne `collection_members` :
// `requireSession()` (lib/auth-guards.ts) le fait retomber sur
// `bootstrapCollection`, qui lui crée une collection neuve à sa prochaine
// requête — aucun code dédié n'est nécessaire ici pour ce cas.
export async function leaveCollection(
  actingUserId: string,
  collectionId: string,
): Promise<{ ok: true } | { ok: false; error: LeaveCollectionError }> {
  await assertMember(actingUserId, collectionId)

  const [self] = await db
    .select({ role: collectionMembers.role })
    .from(collectionMembers)
    .where(
      and(eq(collectionMembers.collectionId, collectionId), eq(collectionMembers.userId, actingUserId)),
    )
    .limit(1)
  if (!self) return { ok: true }

  if (self.role === 'owner' && (await countOwners(collectionId)) <= 1) {
    return { ok: false, error: 'last_owner' }
  }

  await db
    .delete(collectionMembers)
    .where(
      and(eq(collectionMembers.collectionId, collectionId), eq(collectionMembers.userId, actingUserId)),
    )
  return { ok: true }
}

// Suppression définitive d'une collection (Settings › Collection) : réservée
// à un `owner`. Emporte en cascade ses containers, holdings, dossiers et
// adhésions (`packages/db/src/schema.ts`) — irréversible, d'où la confirmation explicite
// côté interface. Les comptes qui l'affichaient retombent sur leur première
// adhésion restante (`users.active_collection_id` → `null`, puis
// lib/collections/active.ts), ou en reçoivent une neuve s'il ne leur en
// reste aucune (lib/collections/bootstrap.ts).
export async function deleteCollection(actingUserId: string, collectionId: string): Promise<void> {
  await assertOwner(actingUserId, collectionId)
  await db.delete(collections).where(eq(collections.id, collectionId))
}

// Invitation par email dans une collection (Settings › Collection), réservée
// à son `owner`. Un email inconnu crée un compte en attente — son username
// se choisira à sa première connexion, comme pour une invitation
// d'Administration › Users. C'est ce qui fait de l'owner un « inviteur » au
// sens du réglage d'inscription : le compte existe, son lien magique partira
// (lib/site-settings.ts#canRequestMagicLink). Un compte déjà existant est
// simplement ajouté. `created` dit à l'appelant s'il doit envoyer le lien.
//
// Créer un compte contourne le réglage d'inscription : seul un appelant qui
// pourrait déjà en créer un (admin, ou inscriptions ouvertes) y est autorisé
// — sinon tout compte, propriétaire de sa propre collection, ouvrirait
// l'instance à n'importe quel email. `allowAccountCreation` est décidé par la
// Server Action.
export async function inviteMemberByEmail(
  actingUserId: string,
  collectionId: string,
  email: string,
  role: GrantableRole = 'editor',
  { allowAccountCreation }: { allowAccountCreation: boolean },
): Promise<
  | { ok: true; member: MemberRow; created: boolean }
  | { ok: false; error: 'already_member' | 'signup_closed' }
> {
  await assertOwner(actingUserId, collectionId)
  const normalized = email.trim().toLowerCase()

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(sql`lower(${users.email}) = ${normalized}`)
      .limit(1)

    let target = existing
    let created = false
    if (!target) {
      if (!allowAccountCreation) return { ok: false as const, error: 'signup_closed' as const }
      const [row] = await tx
        .insert(users)
        .values({ email: normalized })
        .returning({ id: users.id, username: users.username })
      target = row!
      created = true
    }

    const inserted = await tx
      .insert(collectionMembers)
      .values({ collectionId, userId: target.id, role })
      .onConflictDoNothing()
      .returning({ userId: collectionMembers.userId })
    if (inserted.length === 0) return { ok: false as const, error: 'already_member' as const }

    return {
      ok: true as const,
      created,
      member: { userId: target.id, username: target.username ?? normalized, role },
    }
  })
}
