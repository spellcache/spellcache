'use client'

// Groupe `Members` de Settings : membres, transfert, départ, combobox de
// candidats et bloc `Add a member`. Le renommage de la collection a rejoint
// le groupe Collections (`collections-group.tsx`, demande produit). Client :
// ajout, gestion des membres et leurs erreurs sont interactifs — le reste de
// la page (`page.tsx`) reste un composant serveur.
import {
  Crown,
  Eye,
  LogOut,
  Trash2,
  UserMinus,
  UserPen,
  UserPlus,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { deleteCollectionAction } from '@/app/(app)/settings/collections-actions'
import {
  addMemberAction,
  changeMemberRoleAction,
  inviteMemberByEmailAction,
  leaveCollectionAction,
  memberCandidatesAction,
  removeMemberAction,
  transferOwnershipAction,
  type MemberActionError,
} from '@/app/(app)/settings/members-actions'
import { SettingRow } from '@/components/settings/setting-row'
import { SettingsGroup } from '@/components/settings/settings-group'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'
import { SheetGroup, SheetRow } from '@/components/ui/sheet-controls'
import type { MemberRole } from '@spellcache/db/schema'
import type { MemberCandidate, MemberRow } from '@/lib/collections/members'
import { ROLE_LABELS, roleLabel } from '@/lib/collections/roles'

function memberRoleLabel(role: MemberRole): string {
  return roleLabel(role)
}

// Les trois niveaux d'accès, du plus large au plus restreint. `viewer` :
// lecture seule (lib/collections/authorize.ts#canWrite).
// Un seul `owner` par collection : les autres membres sont `editor` ou
// `viewer`, la propriété ne passe que par « Transfer ownership ».
const ROLE_OPTIONS: Array<{ value: 'editor' | 'viewer'; label: string; hint: string }> = [
  {
    value: 'editor',
    label: ROLE_LABELS.editor,
    hint: 'Can add, edit and remove cards, binders and decks',
  },
  { value: 'viewer', label: ROLE_LABELS.viewer, hint: 'Can see everything, change nothing' },
]

function memberActionErrorMessage(error: MemberActionError): string {
  switch (error) {
    case 'not_found':
      return 'Unknown username.'
    case 'already_member':
      return 'This account is already a member of this collection.'
    case 'forbidden':
      return "You don't have permission to do that."
    case 'last_owner':
      return 'Could not complete that.'
    case 'signup_closed':
      return 'No account uses this email. Ask an administrator to invite them.'
    case 'rate_limited':
      return 'Too many invitations. Try again later.'
    case 'invalid':
    default:
      return 'Enter a valid username.'
  }
}

interface PendingConfirm {
  title: string
  message: string
  confirmLabel: string
  run: () => Promise<{ ok: true } | { ok: false; error: MemberActionError }>
  onSuccess?: () => void
  // Texte à recopier avant que la confirmation ne s'active (suppression).
  requiredText?: string
}

export function MembersGroup({
  collectionId,
  collectionName,
  role,
  members,
  currentUserId,
}: {
  collectionId: string
  collectionName: string
  role: MemberRole
  members: MemberRow[]
  currentUserId: string
}) {
  const router = useRouter()
  const [memberList, setMemberList] = useState(members)
  // Le propre rôle de l'appelant, en état local : un transfert de
  // propriété réussi (ci-dessous) le fait passer `owner` → `editor` sans
  // attendre un aller-retour serveur, sinon les sections « Add a member »/
  // « Manage members » resteraient affichées pour un compte qui n'est plus
  // owner.
  const [currentRole, setCurrentRole] = useState(role)
  const isOwner = currentRole === 'owner'

  const [username, setUsername] = useState('')
  // Rôle du membre ajouté, choisi avant l'ajout (`editor` par défaut).
  const [newRole, setNewRole] = useState<'editor' | 'viewer'>('editor')
  const [addError, setAddError] = useState<string | null>(null)
  const [addNotice, setAddNotice] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  // Un `@` fait de la saisie un email : invitation (compte créé s'il
  // n'existe pas) au lieu d'un ajout par username.
  const isEmail = username.includes('@')

  const [candidates, setCandidates] = useState<MemberCandidate[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(isOwner)

  // Membre dont la feuille d'actions est ouverte (owner seulement).
  const [selected, setSelected] = useState<MemberRow | null>(null)
  // Feuille de choix du nouvel owner (zone de danger).
  const [transferOpen, setTransferOpen] = useState(false)
  const [roleError, setRoleError] = useState<string | null>(null)

  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const [confirmPending, setConfirmPending] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  // Un seul aller-retour serveur pour la liste des candidats (réf.
  // `useMemberCandidates`) : le filtrage à la frappe reste ensuite entièrement
  // côté client, dans `MemberCombobox` ci-dessous — jamais une requête par
  // caractère tapé.
  useEffect(() => {
    if (!isOwner) return
    let cancelled = false
    setCandidatesLoading(true)
    void memberCandidatesAction({ collectionId }).then((result) => {
      if (cancelled) return
      setCandidatesLoading(false)
      if (result.ok) setCandidates(result.candidates)
    })
    return () => {
      cancelled = true
    }
  }, [collectionId, isOwner])

  async function handleAddMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAdding(true)
    setAddError(null)
    setAddNotice(null)
    const value = username.trim()
    const result = isEmail
      ? await inviteMemberByEmailAction({ collectionId, email: value, role: newRole })
      : await addMemberAction({ collectionId, username: value, role: newRole })
    setAdding(false)
    if (!result.ok) {
      setAddError(
        isEmail && result.error === 'invalid'
          ? 'Enter a valid email.'
          : memberActionErrorMessage(result.error),
      )
      return
    }
    setMemberList((prev) => [...prev, result.member])
    setCandidates((prev) =>
      prev.filter((candidate) => candidate.username !== result.member.username),
    )
    setUsername('')
    setNewRole('editor')
    if ('created' in result && result.created) {
      setAddNotice(`Invitation sent to ${value}.`)
    }
  }

  function askConfirm(confirmation: PendingConfirm) {
    setConfirmError(null)
    setConfirm(confirmation)
  }

  async function runConfirm() {
    const pending = confirm
    if (!pending) return
    setConfirmPending(true)
    const result = await pending.run()
    setConfirmPending(false)
    if (!result.ok) {
      setConfirmError(memberActionErrorMessage(result.error))
      return
    }
    setConfirm(null)
    pending.onSuccess?.()
  }

  const ownerCount = memberList.filter((member) => member.role === 'owner').length
  // Candidats au transfert de propriété : tout autre membre.
  const transferTargets = memberList.filter((member) => member.userId !== currentUserId)
  const currentMember = memberList.find((member) => member.userId === currentUserId)
  // Un `owner` ne peut partir que s'il en reste un autre (dernier owner :
  // transférer ou supprimer la collection).
  const canLeave = Boolean(currentMember) && (!isOwner || ownerCount > 1)

  // Quitter ou supprimer la collection affichée : retour à Settings, qui
  // relit la collection active de repli.
  function backToSettings() {
    router.push('/settings')
    router.refresh()
  }

  async function changeRole(member: MemberRow, nextRole: 'editor' | 'viewer') {
    setRoleError(null)
    const result = await changeMemberRoleAction({
      collectionId,
      targetUserId: member.userId,
      role: nextRole,
    })
    if (!result.ok) {
      setRoleError(memberActionErrorMessage(result.error))
      return
    }
    setSelected(null)
    setMemberList((prev) =>
      prev.map((row) =>
        row.userId === member.userId ? { ...row, role: nextRole } : row,
      ),
    )
  }

  return (
    <>
      {/* Un `owner` ouvre la feuille d'actions d'un membre d'un tap (rôle,
          transfert, retrait) ; sa propre ligne et celles vues par un
          `editor` restent inertes. */}
      <SettingsGroup label="Members">
        {memberList.map((member) => {
          const manageable = isOwner && member.userId !== currentUserId
          return (
            <SettingRow
              key={member.userId}
              icon={
                member.role === 'owner' ? (
                  <Crown width={18} height={18} strokeWidth={1.75} />
                ) : undefined
              }
              label={
                member.userId === currentUserId
                  ? `${member.username} (you)`
                  : member.username
              }
              value={memberRoleLabel(member.role)}
              chevron={manageable}
              onClick={
                manageable
                  ? () => {
                      setRoleError(null)
                      setSelected(member)
                    }
                  : undefined
              }
            />
          )
        })}
      </SettingsGroup>

      {isOwner && (
        <>
          <div className="mb-10 ml-4 text-section-label font-semibold uppercase tracking-section-label text-text-2">
            Add a member
          </div>
          <form onSubmit={(event) => void handleAddMember(event)}>
            <div className="mb-8 flex gap-8">
              <MemberCombobox
                value={username}
                onChange={setUsername}
                candidates={candidates}
                loading={candidatesLoading}
              />
              <button
                type="submit"
                disabled={adding || username.trim() === ''}
                className="flex flex-shrink-0 items-center gap-6 rounded-control bg-accent px-16 text-row-value font-bold text-on-accent disabled:opacity-60"
              >
                <UserPlus width={15} height={15} strokeWidth={1.75} />
                {isEmail ? 'Invite' : 'Add'}
              </button>
            </div>
            {/* Rôle choisi avant l'ajout ; modifiable ensuite depuis la
                feuille d'actions du membre. */}
            <div className="mb-8">
              <Segmented
                size="compact"
                options={[
                  { value: 'viewer', label: ROLE_LABELS.viewer },
                  { value: 'editor', label: ROLE_LABELS.editor },
                ]}
                value={newRole}
                onChange={setNewRole}
              />
            </div>
          </form>
          <p className="mb-8 ml-4 text-look-hint leading-normal text-text-3">
            {isEmail
              ? 'No account with this email yet? One is created and a sign-in link is sent to it.'
              : 'Pick an existing account by username, or type an email to invite someone new.'}
          </p>
          {/* L'erreur d'ajout s'empile SOUS le hint. */}
          {addError && (
            <p className="mb-22 ml-4 text-look-hint leading-normal text-danger">
              {addError}
            </p>
          )}
          {!addError && addNotice && (
            <p className="mb-22 ml-4 text-look-hint leading-normal text-success">
              {addNotice}
            </p>
          )}
          {!addError && !addNotice && <div className="mb-14" />}
        </>
      )}

      {/* Zone de danger, poussée en bas de l'écran (`mt-auto`, la page est
          une colonne de hauteur pleine — app/(app)/settings/collection). */}
      {(canLeave || isOwner) && (
        <div className="mt-auto pt-22">
          <SettingsGroup label="Danger zone">
            {canLeave && (
              <SettingRow
                icon={<LogOut width={18} height={18} strokeWidth={1.75} />}
                label="Leave collection"
                danger
                chevron={false}
                onClick={() =>
                  askConfirm({
                    title: 'Leave this collection?',
                    message:
                      'You lose access to its cards, binders, lists and decks. Anything you added stays with the collection.',
                    confirmLabel: 'Leave',
                    run: () => leaveCollectionAction({ collectionId }),
                    onSuccess: backToSettings,
                  })
                }
              />
            )}
            {isOwner && (
              <SettingRow
                icon={<Crown width={18} height={18} strokeWidth={1.75} />}
                label="Transfer ownership"
                subtitle={
                  transferTargets.length > 0
                    ? 'Hand the collection over to another member'
                    : 'Add a member first'
                }
                danger
                chevron={false}
                pending={transferTargets.length === 0}
                onClick={
                  transferTargets.length > 0 ? () => setTransferOpen(true) : undefined
                }
              />
            )}
            {isOwner && (
              <SettingRow
                icon={<Trash2 width={18} height={18} strokeWidth={1.75} />}
                label="Delete collection"
                danger
                chevron={false}
                onClick={() =>
                  askConfirm({
                    title: `Delete ${collectionName}?`,
                    message:
                      'Every card, binder, list and deck in it is deleted for all its members. This cannot be undone.',
                    confirmLabel: 'Delete',
                  requiredText: collectionName,
                    run: async () => {
                      const result = await deleteCollectionAction({ collectionId })
                      return result.ok
                        ? result
                        : { ok: false, error: 'forbidden' as const }
                    },
                    onSuccess: backToSettings,
                  })
                }
              />
            )}
          </SettingsGroup>
        </div>
      )}

      {/* Choix du nouvel owner : l'appelant reste `editor` (transferOwnership). */}
      <Sheet
        open={transferOpen}
        onOpenChange={setTransferOpen}
        title="Transfer ownership"
      >
        <SheetGroup>
          {transferTargets.map((member) => (
            <SheetRow
              key={member.userId}
              icon={Crown}
              label={member.username}
              value={memberRoleLabel(member.role)}
              onClick={() => {
                setTransferOpen(false)
                askConfirm({
                  title: `Hand over to ${member.username}?`,
                  message: `${member.username} becomes the owner and you stay on as a contributor. You cannot undo this yourself.`,
                  confirmLabel: 'Transfer',
                  run: () =>
                    transferOwnershipAction({
                      collectionId,
                      targetUserId: member.userId,
                    }),
                  onSuccess: () => {
                    setMemberList((prev) =>
                      prev.map((row) => {
                        if (row.userId === member.userId) return { ...row, role: 'owner' }
                        if (row.userId === currentUserId)
                          return { ...row, role: 'editor' }
                        return row
                      }),
                    )
                    setCurrentRole('editor')
                  },
                })
              }}
            />
          ))}
        </SheetGroup>
      </Sheet>

      {/* Feuille d'actions d'un membre (owner seulement). */}
      <Sheet
        open={Boolean(selected)}
        onOpenChange={(next) => !next && setSelected(null)}
        title={selected?.username ?? ''}
      >
        {selected && (
          <>
            <SheetGroup>
              {ROLE_OPTIONS.filter((option) => option.value !== selected.role).map(
                (option) => (
                  <SheetRow
                    key={option.value}
                    icon={option.value === 'editor' ? UserPen : Eye}
                    label={`Make ${option.label.toLowerCase()}`}
                    hint={option.hint}
                    onClick={() => void changeRole(selected, option.value)}
                  />
                ),
              )}
              <SheetRow
                icon={UserMinus}
                label="Remove from collection"
                hint="Everything they added stays"
                danger
                onClick={() => {
                  const member = selected
                  setSelected(null)
                  askConfirm({
                    title: `Remove ${member.username}?`,
                    message: `${member.username} loses access to this collection. Everything they added stays.`,
                    confirmLabel: 'Remove',
                    run: () =>
                      removeMemberAction({ collectionId, targetUserId: member.userId }),
                    onSuccess: () =>
                      setMemberList((prev) =>
                        prev.filter((row) => row.userId !== member.userId),
                      ),
                  })
                }}
              />
            </SheetGroup>
            {roleError && <p className="mt-12 text-meta text-danger">{roleError}</p>}
          </>
        )}
      </Sheet>

      <ConfirmDialog
        // `key` : le champ de confirmation repart vide à chaque ouverture.
        key={confirm?.title ?? 'closed'}
        open={Boolean(confirm)}
        title={confirm?.title}
        message={confirmError ?? confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        requiredText={confirm?.requiredText}
        pending={confirmPending}
        onClose={() => {
          setConfirm(null)
          setConfirmError(null)
        }}
        onConfirm={() => void runConfirm()}
      />
    </>
  )
}

// Champ « Username » avec la liste déroulante des comptes réellement
// ajoutables : le texte libre reste accepté (le serveur reste l'autorité sur
// qui existe), taper filtre la suggestion plutôt que de deviner.
function MemberCombobox({
  value,
  onChange,
  candidates,
  loading,
}: {
  value: string
  onChange: (next: string) => void
  candidates: MemberCandidate[]
  loading: boolean
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const query = value.trim().toLowerCase()
  const matches = query
    ? candidates.filter((candidate) => candidate.username.toLowerCase().includes(query))
    : candidates
  const showList = open && (loading || candidates.length > 0)

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
        placeholder="Username or email"
        aria-label="Username or email"
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
        aria-controls="member-candidates-listbox"
        className="w-full rounded-control border border-border bg-surface-1 px-12 py-11 text-settings-input text-text outline-none placeholder:text-text-3"
      />

      {showList && (
        <div
          id="member-candidates-listbox"
          role="listbox"
          className="absolute inset-x-0 top-full z-10 mt-6 max-h-member-candidates overflow-y-auto rounded-control border border-border bg-surface-3 p-4 shadow-toast"
        >
          {loading && (
            <div className="px-10 py-10 text-row-value text-text-2">
              Loading accounts...
            </div>
          )}
          {!loading && matches.length === 0 && (
            <div className="px-10 py-10 text-row-value text-text-2">
              No account matches.
            </div>
          )}
          {matches.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="option"
              aria-selected={candidate.username === value}
              // `mousedown` précède `blur` — sans lui le champ fermerait la
              // liste avant que le clic n'y arrive.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(candidate.username)
                setOpen(false)
              }}
              className="block w-full rounded-control-compact px-10 py-10 text-left text-settings-input font-semibold text-text"
            >
              {candidate.username}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
