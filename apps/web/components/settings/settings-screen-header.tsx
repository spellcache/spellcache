'use client'

// En-tête partagé des sous-écrans de Settings (Users et Jobs) : breadcrumb
// « Settings », titre, `onBack`. Îlot client minimal : `ScreenHeader` (component/ui) exige
// un `onBack` appelable, et `Users`/`Jobs` restent des pages serveur — le
// retour navigue par l'historique, comme `deck-view.tsx`
// (`onBack={() => window.history.back()}`), ici via le routeur pour rester
// dans les conventions Next.js.
import { useRouter } from 'next/navigation'

import { ScreenHeader } from '@/components/ui/screen-header'

export function SettingsScreenHeader({ title }: { title: string }) {
  const router = useRouter()
  return <ScreenHeader title={title} breadcrumb="Settings" onBack={() => router.back()} />
}
