'use client'

// « Run now » d'Administration › Jobs : lancer à la main l'import bulk
// (catalogue et prix, puis revalorisation) ou la seule revalorisation. Le
// bouton met le job en file ; le worker l'exécute et le run apparaît dans
// la liste en dessous. Tant qu'un job est en file ou en cours, l'écran se
// relit toutes les 5 secondes pour suivre son état.
import { Coins, DownloadCloud } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { SettingRow } from '@/components/settings/setting-row'
import { SettingsGroup } from '@/components/settings/settings-group'
import type { ManualJob, ManualJobState } from '@/lib/jobs/manual-jobs'

import { triggerJobAction } from './actions'

const REFRESH_MS = 3000
const FOLLOW_MS = 30_000

const JOBS: Record<ManualJob, { label: string; hint: string; Icon: typeof Coins }> = {
  'import-bulk': {
    label: 'Run bulk import now',
    hint: 'Downloads the latest cards and prices, then revalues every collection',
    Icon: DownloadCloud,
  },
  'revalue-containers': {
    label: 'Revalue collections now',
    hint: "Recomputes every binder, deck and collection value from today's prices",
    Icon: Coins,
  },
}

const ERROR_MESSAGES: Record<string, string> = {
  queued: 'Already queued.',
  running: 'Already running.',
  cooldown: 'Ran less than an hour ago.',
  unavailable: 'The job queue is unreachable. Is the worker running?',
  forbidden: 'You must be an admin to run jobs.',
  invalid: 'Unknown job.',
}

function minutesUntil(date: Date): number {
  return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 60_000))
}

export function RunNowGroup({ states }: { states: ManualJobState[] }) {
  const router = useRouter()
  const [pending, setPending] = useState<ManualJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Suivi après un lancement : un job court (revalorisation) peut finir
  // avant le premier rafraîchissement — on relit l'écran quelques secondes
  // de plus pour que son run apparaisse dans la liste.
  const [followUntil, setFollowUntil] = useState(0)
  const busy = states.some((state) => state.queued || state.running)

  useEffect(() => {
    if (!busy && followUntil === 0) return
    const timer = setInterval(() => {
      router.refresh()
      if (!busy && Date.now() > followUntil) setFollowUntil(0)
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [busy, followUntil, router])

  async function handleRun(job: ManualJob) {
    setPending(job)
    setError(null)
    const result = await triggerJobAction({ job })
    setPending(null)
    if (!result.ok) setError(ERROR_MESSAGES[result.error] ?? 'Could not start this job.')
    else setFollowUntil(Date.now() + FOLLOW_MS)
    router.refresh()
  }

  return (
    <>
      <SettingsGroup label="Run now" hint={error ?? undefined}>
        {states.map((state) => {
          const { label, hint, Icon } = JOBS[state.job]
          const blocked = state.queued || state.running || state.availableAt !== null
          const status = state.running
            ? 'Running'
            : state.queued
              ? 'Queued'
              : state.availableAt
                ? `In ${minutesUntil(state.availableAt)} min`
                : undefined
          return (
            <SettingRow
              key={state.job}
              icon={<Icon width={18} height={18} strokeWidth={1.75} />}
              label={label}
              subtitle={hint}
              value={status}
              chevron={false}
              pending={pending === state.job || blocked}
              onClick={blocked ? undefined : () => void handleRun(state.job)}
            />
          )
        })}
      </SettingsGroup>
      {error && <div className="mb-22" />}
    </>
  )
}
