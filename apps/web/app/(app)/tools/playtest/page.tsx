// Playtest — choix du deck. Composant serveur : garde de session puis garde
// d'outil, exactement comme `/tools/life` — la route répond 404 tant que
// l'outil n'est pas activé dans Settings.
import { FlaskConical } from 'lucide-react'
import { notFound } from 'next/navigation'

import { SettingRow } from '@/components/settings/setting-row'
import { SettingsGroup } from '@/components/settings/settings-group'
import { Screen } from '@/components/ui/screen'
import { ScreenHeader } from '@/components/ui/screen-header'
import { requireSession } from '@/lib/auth-guards'
import { getToolFlags } from '@/lib/tools/tool-flags'

import { listPlaytestDecks } from './playtest-data'

export default async function PlaytestPage() {
  const session = await requireSession()
  const tools = await getToolFlags(session.id)
  if (!tools.playtest) notFound()

  const decks = await listPlaytestDecks(session.id)

  return (
    <Screen
      header={<ScreenHeader title="Playtest" breadcrumb="Tools" backHref="/tools" />}
    >
      {decks.length === 0 ? (
        <SettingsGroup label="Choose a deck">
          <SettingRow
            label="No decks yet"
            subtitle="Create a deck to test it here"
            href="/decks"
          />
        </SettingsGroup>
      ) : (
        <SettingsGroup label="Choose a deck">
          {decks.map((deck) => (
            <SettingRow
              key={deck.id}
              icon={<FlaskConical width={18} height={18} strokeWidth={1.75} />}
              label={deck.name}
              subtitle={[deck.formatLabel, `${deck.mainboardCount} cards`]
                .filter(Boolean)
                .join(' · ')}
              href={`/tools/playtest/${deck.id}`}
            />
          ))}
        </SettingsGroup>
      )}
    </Screen>
  )
}
