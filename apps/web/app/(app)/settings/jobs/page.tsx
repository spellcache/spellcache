// Administration › Jobs : état des
// dix dernières exécutions du worker (import bulk, revalorisation), visible
// admin seulement — un `member` reçoit un vrai 403, pas un masquage
// d'interface (même garde que `Administration › Users`). Sans design
// dédié : composé exclusivement des composants et tokens déjà livrés
// (docs/development.md, anti-patterns : aucun langage visuel nouveau),
// même patron que `app/(app)/settings/users/page.tsx`.
import { forbidden } from 'next/navigation'

import { SettingsGroup } from '@/components/settings/settings-group'
import { SettingsScreenHeader } from '@/components/settings/settings-screen-header'
import { Screen } from '@/components/ui/screen'
import { ForbiddenError, requireAdmin } from '@/lib/auth-guards'

import { getManualJobStates } from '@/lib/jobs/manual-jobs'

import { getRecentJobRuns, type JobRun } from './jobs-data'
import { RunNowGroup } from './run-now-group'

const SOURCE_LABELS: Record<string, string> = {
  default_cards: 'Bulk import',
  'revalue-containers': 'Revalue containers',
}

const STATUS_LABELS: Record<string, string> = {
  running: 'Running',
  success: 'Success',
  error: 'Error',
}

const STATUS_CLASSNAMES: Record<string, string> = {
  running: 'text-text-2',
  success: 'text-success',
  error: 'text-danger',
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function formatDuration(run: JobRun): string {
  if (!run.finishedAt) return 'running'

  const ms = run.finishedAt.getTime() - run.startedAt.getTime()
  if (ms < 1000) return `${ms}ms`

  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}

export default async function JobsPage() {
  try {
    await requireAdmin()
  } catch (error) {
    if (error instanceof ForbiddenError) forbidden()
    throw error
  }

  const [runs, jobStates] = await Promise.all([getRecentJobRuns(), getManualJobStates()])

  return (
    <Screen header={<SettingsScreenHeader title="Jobs" />}>
      <RunNowGroup states={jobStates} />

      <div className="mb-10 ml-4 text-section-label font-semibold uppercase tracking-section-label text-text-2">
        Last {runs.length} runs
      </div>

      {runs.length === 0 ? (
        <div className="rounded-row border border-border bg-surface-1 px-14 py-13 text-row-label text-text-2">
          No run yet.
        </div>
      ) : (
        <SettingsGroup>
          {runs.map((run) => (
            <div key={run.id} className="flex flex-col gap-4 px-14 py-13">
              <div className="flex items-center gap-12">
                <div className="min-w-0 flex-1 truncate text-row-label font-semibold text-text">
                  {SOURCE_LABELS[run.source] ?? run.source}
                </div>
                <span className="text-meta text-text-2">{formatDuration(run)}</span>
                <span className="text-meta text-text-2">{run.rowsUpserted} rows</span>
                <span
                  className={`text-meta font-semibold ${STATUS_CLASSNAMES[run.status] ?? 'text-text-2'}`}
                >
                  {STATUS_LABELS[run.status] ?? run.status}
                </span>
              </div>
              <div className="text-meta text-text-3">
                {dateFormatter.format(run.startedAt)}
              </div>
              {run.errorMessage && (
                <div className="truncate text-meta text-danger">{run.errorMessage}</div>
              )}
            </div>
          ))}
        </SettingsGroup>
      )}
    </Screen>
  )
}
