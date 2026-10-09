'use client'

// Liste des comptes d'Administration › Users : cartes séparées (`gap-11`),
// pas une carte unique à filets — chaque ligne est un bouton qui ouvre
// `ManageUserSheet`. Badges « You »/« Admin » seulement : des badges d'état
// de compte n'auraient pas de sens avec l'auth en lien magique ; l'email
// reste affiché, il est l'identifiant réel du lien magique.
import { Check, ChevronRight, Mail, Shield, ShieldOff, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import { useSelection } from '@/components/selection/selection-provider'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

import { SettingRow } from '@/components/settings/setting-row'
import { SettingsGroup } from '@/components/settings/settings-group'
import { Segmented } from '@/components/ui/segmented'

import { bulkAccountsAction, type BulkAccountsOp } from '../actions'
import type { AdminAccountRow } from './accounts-data'
import { ManageUserSheet } from './manage-user-sheet'

function Badge({ label, accent = false }: { label: string; accent?: boolean }) {
  return (
    <span
      className={`flex-shrink-0 rounded-pill bg-surface-2 px-8 py-2 text-pill-badge font-bold uppercase tracking-badge-foil ${
        accent ? 'text-accent-text' : 'text-text-2'
      }`}
    >
      {label}
    </span>
  )
}

type Filter = 'all' | 'active' | 'pending' | 'admins'
type Sort = 'newest' | 'oldest' | 'name'

// Un compte « en attente » a été invité mais n'a jamais terminé l'onboarding :
// il n'a pas encore de username.
function isPending(account: AdminAccountRow): boolean {
  return account.username === null
}

const RECENT_DAYS = 30

// Rond de sélection des lignes cochables (même rendu que `SlotRow`).
function SelectionCircle({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={
        selected
          ? 'flex h-selection-circle w-selection-circle flex-shrink-0 items-center justify-center rounded-full border-thin border-accent bg-accent'
          : 'flex h-selection-circle w-selection-circle flex-shrink-0 items-center justify-center rounded-full border-thin border-text-3 bg-transparent'
      }
    >
      {selected && <Check width={11} height={11} strokeWidth={3.5} className="text-on-accent" />}
    </span>
  )
}

// Barre d'actions groupées, au gabarit de `components/selection/action-bar.tsx`
// (même emplacement que la barre d'onglets, masquée tant que la sélection
// est active — app/(app)/app-shell.tsx).
function AccountsActionBar({
  disabled,
  onRun,
}: {
  disabled: boolean
  onRun: (op: BulkAccountsOp) => void
}) {
  const items: Array<{ op: BulkAccountsOp; label: string; Icon: typeof Mail; danger?: boolean }> = [
    { op: 'make_admin', label: 'Admin', Icon: Shield },
    { op: 'make_member', label: 'Regular', Icon: ShieldOff },
    { op: 'resend_invite', label: 'Resend', Icon: Mail },
    { op: 'delete', label: 'Delete', Icon: Trash2, danger: true },
  ]
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex gap-8 border-t border-surface-2 bg-surface-3 px-12 pt-10 pb-tab-bar-bottom">
      {items.map(({ op, label, Icon, danger }) => (
        <button
          key={op}
          type="button"
          disabled={disabled}
          onClick={() => onRun(op)}
          className={`flex flex-1 flex-col items-center gap-5 py-8 text-action-bar-label font-semibold disabled:opacity-50 ${
            danger ? 'text-danger' : 'text-text'
          }`}
        >
          <Icon width={19} height={19} strokeWidth={1.75} />
          {label}
        </button>
      ))}
    </nav>
  )
}

const OP_NOTICE: Record<BulkAccountsOp, (n: number) => string> = {
  make_admin: (n) => `${n} account${n === 1 ? '' : 's'} made admin.`,
  make_member: (n) => `${n} account${n === 1 ? '' : 's'} made regular.`,
  resend_invite: (n) => `Invitation resent to ${n} pending account${n === 1 ? '' : 's'}.`,
  delete: (n) => `${n} account${n === 1 ? '' : 's'} deleted.`,
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

export function UsersList({
  accounts: initialAccounts,
  currentUserId,
}: {
  accounts: AdminAccountRow[]
  currentUserId: string
}) {
  const [accounts, setAccounts] = useState(initialAccounts)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('newest')

  // Sélection multiple : le contexte partagé de l'app (masque la barre
  // d'onglets, Échap pour sortir). Le propre compte de l'admin n'est jamais
  // sélectionnable — les actions groupées l'excluent de toute façon.
  const router = useRouter()
  const selection = useSelection()
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const selectedIds = [...selection.ids].filter((id) => id !== currentUserId)

  async function runBulk(op: BulkAccountsOp) {
    if (selectedIds.length === 0) return
    setRunning(true)
    const result = await bulkAccountsAction({ userIds: selectedIds, op })
    setRunning(false)
    setConfirmDelete(false)
    if (!result.ok) {
      setNotice('Could not apply this action.')
      return
    }
    // Comptes non supprimés : owners d'une collection partagée.
    const blockedIds = new Set(result.blocked.map((entry) => entry.userId))
    const ids = new Set(selectedIds.filter((id) => !blockedIds.has(id)))
    if (op === 'delete') {
      setAccounts((prev) => prev.filter((account) => !ids.has(account.id)))
    } else if (op !== 'resend_invite') {
      const role = op === 'make_admin' ? 'admin' : 'member'
      setAccounts((prev) =>
        prev.map((account) => (ids.has(account.id) ? { ...account, role } : account)),
      )
    }
    setNotice(
      OP_NOTICE[op](result.affected) +
        (result.blocked.length > 0
          ? ` Not deleted, they own a shared collection — transfer it first: ${result.blocked
              .map((entry) => entry.label)
              .join(', ')}.`
          : ''),
    )
    selection.clear()
    router.refresh()
  }

  const selected = accounts.find((account) => account.id === selectedId) ?? null

  // Statistiques calculées sur la liste déjà chargée — aucune requête de
  // plus pour quelques compteurs.
  const stats = useMemo(() => {
    const since = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000
    return {
      total: accounts.length,
      active: accounts.filter((account) => !isPending(account)).length,
      pending: accounts.filter(isPending).length,
      admins: accounts.filter((account) => account.role === 'admin').length,
      recent: accounts.filter((account) => account.createdAt.getTime() >= since).length,
    }
  }, [accounts])

  const shown = useMemo(() => {
    const filtered = accounts.filter((account) =>
      filter === 'active'
        ? !isPending(account)
        : filter === 'pending'
          ? isPending(account)
          : filter === 'admins'
            ? account.role === 'admin'
            : true,
    )
    return [...filtered].sort((a, b) => {
      if (sort === 'name') {
        return (a.username ?? a.email).localeCompare(b.username ?? b.email)
      }
      const delta = a.createdAt.getTime() - b.createdAt.getTime()
      return sort === 'oldest' ? delta : -delta
    })
  }, [accounts, filter, sort])

  return (
    <>
      <SettingsGroup label="Overview">
        <SettingRow label="Accounts" value={String(stats.total)} chevron={false} />
        <SettingRow label="Active" value={String(stats.active)} chevron={false} />
        <SettingRow label="Pending invites" value={String(stats.pending)} chevron={false} />
        <SettingRow label="Admins" value={String(stats.admins)} chevron={false} />
        <SettingRow
          label={`New in the last ${RECENT_DAYS} days`}
          value={String(stats.recent)}
          chevron={false}
        />
      </SettingsGroup>

      <div className="mx-4 mb-10 flex items-baseline justify-between gap-10">
        <div className="text-section-label font-semibold uppercase tracking-section-label text-text-2">
          {selection.active ? `${selectedIds.length} selected` : `Accounts · ${shown.length}`}
        </div>
        {selection.active ? (
          <div className="flex gap-14">
            <button
              type="button"
              onClick={() =>
                selection.selectRange(
                  shown.map((account) => account.id).filter((id) => id !== currentUserId),
                )
              }
              className="text-meta font-bold text-accent-text"
            >
              Select all shown
            </button>
            <button
              type="button"
              onClick={() => selection.clear()}
              className="text-meta font-bold text-text-2"
            >
              Done
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => selection.selectRange([])}
            className="text-meta font-bold text-accent-text"
          >
            Select
          </button>
        )}
      </div>
      {notice && <p className="mb-10 ml-4 text-meta text-success">{notice}</p>}
      <div className="mb-8">
        <Segmented<Filter>
          size="compact"
          options={[
            { value: 'all', label: `All ${stats.total}` },
            { value: 'active', label: `Active ${stats.active}` },
            { value: 'pending', label: `Pending ${stats.pending}` },
            { value: 'admins', label: `Admins ${stats.admins}` },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>
      <div className="mb-14">
        <Segmented<Sort>
          size="compact"
          options={[
            { value: 'newest', label: 'Newest' },
            { value: 'oldest', label: 'Oldest' },
            { value: 'name', label: 'A–Z' },
          ]}
          value={sort}
          onChange={setSort}
        />
      </div>

      {shown.length === 0 && (
        <p className="ml-4 text-meta text-text-2">No account matches this filter.</p>
      )}
      <div className="flex flex-col gap-11">
        {shown.map((account) => (
          <button
            key={account.id}
            type="button"
            onClick={() =>
              selection.active
                ? account.id !== currentUserId && selection.toggle(account.id)
                : setSelectedId(account.id)
            }
            aria-pressed={selection.active ? selection.ids.has(account.id) : undefined}
            className={`flex w-full items-center gap-14 rounded-card border border-border bg-surface-1 p-12 text-left ${
              selection.active && account.id === currentUserId ? 'opacity-50' : ''
            }`}
          >
            {selection.active && <SelectionCircle selected={selection.ids.has(account.id)} />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-7">
                <span className="truncate text-row-label font-bold text-text">
                  {account.username ?? 'Pending invite'}
                </span>
                {account.id === currentUserId && <Badge label="You" />}
                {account.role === 'admin' && <Badge label="Admin" accent />}
              </div>
              <div className="truncate text-meta text-text-2">{account.email}</div>
              {/* Date d'invitation (en attente) ou d'arrivée (actif). */}
              <div className="truncate text-meta text-text-3">
                {isPending(account) ? 'Invited' : 'Joined'} {dateFormatter.format(account.createdAt)}
              </div>
            </div>
            {!selection.active && (
              <ChevronRight width={18} height={18} strokeWidth={1.75} className="flex-shrink-0 text-text-3" />
            )}
          </button>
        ))}
      </div>

      {/* La barre est fixe : sans cette réserve, elle recouvre les derniers
          comptes de la liste. */}
      {selection.active && <div aria-hidden className="h-above-tab-bar" />}

      {selection.active && (
        <AccountsActionBar
          disabled={running || selectedIds.length === 0}
          onRun={(op) => (op === 'delete' ? setConfirmDelete(true) : void runBulk(op))}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${selectedIds.length} account${selectedIds.length === 1 ? '' : 's'}?`}
        message="Collections they are the only member of are deleted with them. Accounts that own a collection shared with others are skipped. This cannot be undone."
        confirmLabel="Delete"
        pending={running}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void runBulk('delete')}
      />

      {selected && (
        <ManageUserSheet
          key={selected.id}
          account={selected}
          isSelf={selected.id === currentUserId}
          open
          onClose={() => setSelectedId(null)}
          onRoleChange={(userId, isAdmin) =>
            setAccounts((prev) =>
              prev.map((account) =>
                account.id === userId ? { ...account, role: isAdmin ? 'admin' : 'member' } : account,
              ),
            )
          }
          onDeleted={(userId) =>
            setAccounts((prev) => prev.filter((account) => account.id !== userId))
          }
        />
      )}
    </>
  )
}
