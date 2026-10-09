'use server'

// Lancement manuel d'un job (Administration › Jobs), admin seulement.
import { z } from 'zod'

import { ForbiddenError, requireAdmin } from '@/lib/auth-guards'
import { triggerJob, type TriggerJobError } from '@/lib/jobs/manual-jobs'

const triggerInputSchema = z.object({ job: z.enum(['import-bulk', 'revalue-containers']) })

export async function triggerJobAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: TriggerJobError | 'forbidden' | 'invalid' }> {
  try {
    await requireAdmin()
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: 'forbidden' }
    throw error
  }
  const parsed = triggerInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  return triggerJob(parsed.data.job)
}
