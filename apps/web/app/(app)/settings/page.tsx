// Settings — page unique (`Settings · one page`) : aucun sous-écran hormis
// `Administration › Users`/`Jobs` et `Logout`. Composant serveur (la rendre
// entièrement côté client ferait reflow toute la page à chaque bascule) —
// seuls les contrôles listés ci-dessous (`StyleRow`, `DensityRow`,
// `ToggleRow`, `CurrencyRow`, `MembersGroup`, `LogoutRow`) sont des îlots
// `'use client'`.
import { Activity, Info, Users as UsersIcon } from 'lucide-react'

import packageJson from '@/package.json'
import { LegalRow } from '@/components/settings/legal-row'
import { LogoutRow } from '@/components/settings/logout-row'
import { CollectionsGroup } from '@/components/settings/collections-group'
import { PlannedToolRow } from '@/components/settings/planned-tool-row'
import {
  AccentRow,
  ColorSchemeRow,
  CurrencyRow,
  DensityRow,
  StyleRow,
  ToggleRow,
} from '@/components/settings/preference-controls'
import { Screen } from '@/components/ui/screen'
import { ScreenHeader } from '@/components/ui/screen-header'
import { SettingRow } from '@/components/settings/setting-row'
import { SettingsGroup } from '@/components/settings/settings-group'
import { BREAKPOINTS } from '@/lib/breakpoints'
import { requireSession } from '@/lib/auth-guards'
import { TOOLS } from '@/lib/tools/tools'

import { logoutAction } from './actions'
import { getSettingsData } from './settings-data'

export default async function SettingsPage() {
  const session = await requireSession()
  const data = await getSettingsData(session.id)

  const initial = data.username.slice(0, 1).toUpperCase()

  return (
    <Screen header={<ScreenHeader title="Settings" />}>
      <div className="mb-22 flex items-center gap-16 rounded-card bg-gradient-value-band p-20">
        <div className="flex h-avatar w-avatar flex-shrink-0 items-center justify-center rounded-full bg-avatar-bg text-avatar-initial font-extrabold text-accent">
          {initial}
        </div>
        <div className="min-w-0">
          <div className="text-profile-username font-extrabold tracking-profile-username text-on-accent">
            {data.username}
          </div>
          {/* « User », pas « Member » pour un non-admin. */}
          <div className="mt-2 text-meta text-value-band-caption">
            {data.siteRole === 'admin' ? 'Admin' : 'User'}
          </div>
        </div>
      </div>

      <CollectionsGroup collections={data.collections} />

      <SettingsGroup label="Appearance">
        <ColorSchemeRow initialValue={data.preferences.colorScheme} />
        <AccentRow initialValue={data.preferences.accentColor} />
        <ToggleRow
          field="pureBlack"
          label="Pure black background"
          subtitle="True black for OLED screens"
          darkOnly
          initialValue={data.preferences.pureBlack}
        />
        <StyleRow
          field="collectionStyle"
          label="Collection home"
          hint="How the Collection tab lists your binders"
          initialValue={data.preferences.collectionStyle}
        />
        <DensityRow initialValue={data.preferences.density} />
        <ToggleRow
          field="previewPane"
          label="Card preview pane"
          subtitle={`Desktop only — replaces the card sheet from ${BREAKPOINTS.previewPane}px wide`}
          initialValue={data.preferences.previewPane}
          phoneHidden
        />
        <ToggleRow
          field="pricesOnArt"
          label="Display prices"
          initialValue={data.preferences.pricesOnArt}
        />
        {/* Nommée pour ce qu'elle fait, pas pour l'un des deux endroits où
            elle agit : la même préférence pilote aussi bien les
            en-têtes de deck que les binders. */}
        <ToggleRow
          field="binderBackdrops"
          label="Artwork and tints"
          subtitle="Allow a colour or card art per binder and deck"
          initialValue={data.preferences.binderBackdrops}
        />
      </SettingsGroup>

      <SettingsGroup label="Preferences">
        <CurrencyRow initialValue={data.preferences.priceSource} />
      </SettingsGroup>

      {/* Groupe Tools : catalogue unique
          (`lib/tools/tools.ts`), lu ici comme par l'onglet Tools — pas de
          sous-titre, pas de hint de groupe, badge uniforme « PLANNED ». */}
      <SettingsGroup label="Tools">
        {TOOLS.map((tool) =>
          tool.state === 'shipped' ? (
            <ToggleRow
              key={tool.key}
              field="toolLifeTracker"
              label={tool.name}
              initialValue={data.preferences.toolLifeTracker}
            />
          ) : (
            <PlannedToolRow
              key={tool.key}
              icon={<tool.Icon width={18} height={18} strokeWidth={1.75} />}
              label={tool.name}
            />
          ),
        )}
      </SettingsGroup>

      {data.accountCount !== null && (
        <SettingsGroup label="Administration">
          {/* Chevron seul, pas de valeur « {n} accounts ». */}
          <SettingRow
            icon={<UsersIcon width={18} height={18} strokeWidth={1.75} />}
            label="Users"
            href="/settings/users"
          />
          <SettingRow
            icon={<Activity width={18} height={18} strokeWidth={1.75} />}
            label="Jobs"
            href="/settings/jobs"
          />
        </SettingsGroup>
      )}

      <SettingsGroup label="About">
        <SettingRow
          icon={<Info width={18} height={18} strokeWidth={1.75} />}
          label="Version"
          value={packageJson.version}
        />
        {/* Mentions exigées par les conditions de Scryfall (attribution) et
            la Fan Content Policy de Wizards of the Coast, réunies dans la
            feuille qu'ouvre cette ligne. */}
        <LegalRow />
      </SettingsGroup>

      {/* Marge basse propre à la dernière ligne (demande produit) : le
          `pb-28` du corps de `Screen` seul laissait `Logout` trop collé au
          bas de l'écran / à la barre d'onglets. */}
      <div className="mb-28 overflow-hidden rounded-row border border-border bg-surface-1">
        <LogoutRow logoutAction={logoutAction} />
      </div>
    </Screen>
  )
}
