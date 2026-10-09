// Onglet Tools — liste des apps (écran `Tools tab · app list`). Composant
// serveur : garde de session puis garde d'outil — l'onglet caché ne suffit
// pas, la route doit répondre 404 tant qu'aucun outil n'est actif. Le
// prédicat vient de `lib/tools/tools.ts`, jamais réécrit ici.
//
// Catalogue unique `TOOLS` : cette page ET le groupe `Tools` de Settings
// (`app/(app)/settings/page.tsx`) lisent la même liste — jamais deux
// énumérations en dur qui pourraient diverger. Pas de paragraphe d'intro
// sous le h1.
import { notFound } from 'next/navigation'

import { Screen } from '@/components/ui/screen'
import { AppTile } from '@/components/tools/app-tile'
import { requireSession } from '@/lib/auth-guards'
import { getToolFlags } from '@/lib/tools/tool-flags'
import { anyToolEnabled, isToolEnabled, TOOLS } from '@/lib/tools/tools'

const ICON_SIZE = 21
const STROKE_WIDTH = 1.75

export default async function ToolsPage() {
  const session = await requireSession()
  const tools = await getToolFlags(session.id)
  if (!anyToolEnabled(tools)) notFound()

  return (
    <Screen
      header={
        <h1 className="mb-20 text-title-screen font-extrabold tracking-title-screen text-text">
          Tools
        </h1>
      }
    >
      <div className="flex flex-col gap-11">
        {TOOLS.map((tool) => {
          const on = tool.state === 'shipped' && isToolEnabled(tool.key, tools)
          return (
            <AppTile
              key={tool.key}
              name={tool.name}
              state={on ? 'on' : 'off'}
              href={on ? tool.path : undefined}
              tagLabel={tool.state === 'planned' ? 'PLANNED' : undefined}
              icon={<tool.Icon width={ICON_SIZE} height={ICON_SIZE} strokeWidth={STROKE_WIDTH} />}
              description={tool.description}
            />
          )
        })}
      </div>
    </Screen>
  )
}
