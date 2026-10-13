// Réglages du scanner, enregistrés sur le compte (`users.scanner_settings`).
// Deux auteurs : l'app Android (caméra, `CameraSettings.java`) et l'écran de
// revue (son, vibration, sets, foil). Chacun n'envoie que ses clés, d'où une
// écriture par fusion : l'un n'efface jamais les réglages de l'autre.
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { users } from '@spellcache/db/schema'
import { db } from '@spellcache/db'

export const MAX_FILTER_SETS = 100

export const scannerSettingsSchema = z
  .object({
    scanMode: z.enum(['frame', 'auto']),
    viewMode: z.enum(['fill', 'whole']),
    frameSize: z.number().min(0.1).max(1),
    cameraId: z.string().max(32).nullable(),
    zoomRatio: z.number().min(0.1).max(100),
    focusMode: z.enum(['continuous', 'tap', 'manual']),
    focusPosition: z.number().min(0).max(1),
    exposureIndex: z.number().int().min(-100).max(100),
    exposureMode: z.enum(['auto', 'manual']),
    torchOn: z.boolean(),
    // Niveau d'intensité du flash, `0` : celui de l'appareil.
    torchLevel: z.number().int().min(0).max(1000),
    // Retour d'une carte comptée.
    sound: z.boolean(),
    vibration: z.boolean(),
    // Cartes reçues cochées foil dans l'écran de revue.
    foilDefault: z.boolean(),
    // Langue des cartes ajoutées ; `auto` : celle lue sur le plus de cartes.
    language: z.enum(['auto', 'en', 'fr', 'de', 'es', 'it', 'pt', 'ja']),
    // État des cartes ajoutées.
    condition: z.enum(['nm', 'lp', 'mp', 'hp', 'dmg']),
    // Seules les cartes de ces sets sont comptées (`lib/scanner/lookup.ts`) ;
    // vide : tous les sets.
    sets: z
      .array(z.string().trim().toLowerCase().regex(/^[a-z0-9]{2,8}$/))
      .max(MAX_FILTER_SETS)
      .transform((codes) => [...new Set(codes)]),
  })
  .partial()
  .strict()

export type ScannerSettings = z.infer<typeof scannerSettingsSchema>

// Réglages enregistrés avant un changement de forme : les clés inconnues ou
// invalides sont ignorées plutôt que de faire échouer la lecture.
export async function getScannerSettings(userId: string): Promise<ScannerSettings> {
  const [row] = await db
    .select({ settings: users.scannerSettings })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const parsed = scannerSettingsSchema.safeParse(row?.settings ?? {})
  return parsed.success ? parsed.data : {}
}

// Fusion avec les réglages enregistrés (`||` de jsonb, premier niveau).
export async function saveScannerSettings(userId: string, settings: ScannerSettings): Promise<ScannerSettings> {
  await db
    .update(users)
    .set({ scannerSettings: sql`${users.scannerSettings} || ${JSON.stringify(settings)}::jsonb` })
    .where(eq(users.id, userId))
  return getScannerSettings(userId)
}
