// Contrat de la file de jobs, partagé par le serveur web (qui dépose un job,
// Administration › Jobs) et le worker (qui le consomme). Une seule définition :
// la clé Redis et les noms de jobs ne peuvent plus diverger entre les deux.
//
// Importé par le worker sans alias `@/` (Node exécute le TypeScript tel quel) :
// ce module ne dépend que de `zod`.
import { z } from 'zod'

export const WORKER_QUEUE_KEY = 'spellcache:worker:jobs'

export const jobNameSchema = z.enum(['import-bulk', 'revalue-containers'])
export type JobName = z.infer<typeof jobNameSchema>
