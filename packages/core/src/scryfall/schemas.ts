// Schémas Zod des objets Scryfall consommés par le catalogue : cartes du
// bulk `default_cards`, réponse `/bulk-data/<type>`, réponse `/cards/collection`.
//
// Toute donnée reçue de Scryfall passe par ces schémas avant d'atteindre la
// base — jamais castée (docs/development.md, « Toute entrée externe… »).
import { z } from 'zod'

// Doit rester synchronisé avec `Legality` dans `packages/db/src/schema.ts` (source de
// vérité du type — pas d'import croisé pour éviter un cycle avec ce fichier,
// dont `packages/db/src/schema.ts` importe déjà `ScryfallImageUris`).
export const legalitySchema = z.enum(['legal', 'not_legal', 'restricted', 'banned'])

export const scryfallImageUrisSchema = z.object({
  small: z.string().optional(),
  normal: z.string().optional(),
  large: z.string().optional(),
  png: z.string().optional(),
  art_crop: z.string().optional(),
  border_crop: z.string().optional(),
})
export type ScryfallImageUris = z.infer<typeof scryfallImageUrisSchema>

// Les prix Scryfall sont des chaînes décimales ou `null` — jamais
// des nombres JSON, pour ne pas perdre de précision en JSON.parse.
const priceString = z.union([z.string(), z.null()]).catch(null)

export const scryfallPricesSchema = z.object({
  usd: priceString,
  usd_foil: priceString,
  eur: priceString,
  eur_foil: priceString,
})
export type ScryfallPrices = z.infer<typeof scryfallPricesSchema>

export const scryfallCardSchema = z.object({
  id: z.uuid(),
  oracle_id: z.uuid(),
  name: z.string(),
  set: z.string(),
  set_name: z.string().nullish(),
  // `set_type`/`layout` : alimentent `sets.set_type` et `cards.layout`
  // (filtre « Ignore Tokens and Art Series »). Nullish par prudence — un
  // bulk qui les omettrait ne doit pas faire échouer l'import.
  set_type: z.string().nullish(),
  layout: z.string().nullish(),
  collector_number: z.string(),
  rarity: z.string(),
  mana_cost: z.string().nullish(),
  cmc: z.number(),
  type_line: z.string(),
  oracle_text: z.string().nullish(),
  colors: z.array(z.string()).default([]),
  color_identity: z.array(z.string()).default([]),
  finishes: z.array(z.string()).default([]),
  image_uris: scryfallImageUrisSchema.nullish(),
  // Une carte recto-verso (et toute carte à plusieurs faces) ne porte pas
  // `image_uris` au premier niveau : ses illustrations vivent par face. Sans
  // cela, 15 829 cartes du catalogue — 12 % — n'avaient aucune image et
  // rendaient en vignette cassée.
  card_faces: z
    .array(z.object({ image_uris: scryfallImageUrisSchema.nullish() }).loose())
    .nullish(),
  legalities: z.record(z.string(), legalitySchema),
  artist: z.string().nullish(),
  released_at: z.string().nullish(),
  prices: scryfallPricesSchema.nullish(),
})
export type ScryfallCard = z.infer<typeof scryfallCardSchema>

// Réponse de `GET /bulk-data/<type>`.
//
// Scryfall a renommé les deux champs du fichier : `jsonl_download_uri` et
// `compressed_size` remplacent `download_uri` et `size` (le bulk est servi en
// JSONL plutôt qu'en tableau JSON). Les deux graphies sont acceptées et
// aucune n'est requise seule — c'est `.refine` qui exige qu'au moins une URL
// soit là, pour qu'une réponse sans aucune des deux échoue à la frontière
// plutôt que plus loin, dans le téléchargement.
//
// `size`/`compressed_size` ne sont lus par personne : gardés facultatifs pour
// que leur prochain changement de nom ne casse rien.
export const bulkDataEntrySchema = z
  .object({
    object: z.literal('bulk_data'),
    id: z.string(),
    type: z.string(),
    updated_at: z.string(),
    jsonl_download_uri: z.string().optional(),
    download_uri: z.string().optional(),
    compressed_size: z.number().optional(),
    size: z.number().optional(),
  })
  .refine((entry) => Boolean(entry.jsonl_download_uri ?? entry.download_uri), {
    message: 'bulk-data entry carries neither jsonl_download_uri nor download_uri',
    path: ['jsonl_download_uri'],
  })
export type BulkDataEntry = z.infer<typeof bulkDataEntrySchema>

// Réponse de `POST /cards/collection`.
export const cardCollectionResponseSchema = z.object({
  object: z.literal('list'),
  not_found: z
    .array(
      z.object({
        id: z.string().optional(),
        set: z.string().optional(),
        collector_number: z.string().optional(),
      }),
    )
    .default([]),
  data: z.array(scryfallCardSchema),
})
export type CardCollectionResponse = z.infer<typeof cardCollectionResponseSchema>

// Réponse de `GET /sets` (worker uniquement, une requête par import) : seule
// l'icône nous intéresse. Elle porte un cache-buster (`fra.svg?1788148800`)
// sans lequel le CDN de Scryfall répond 404 pour les sets récents — l'URL
// composée à la main depuis le code ne suffit donc pas (cf. import-bulk.ts).
export const scryfallSetSchema = z.object({
  code: z.string(),
  icon_svg_uri: z.string(),
  parent_set_code: z.string().nullish(),
})
export type ScryfallSet = z.infer<typeof scryfallSetSchema>

export const setListResponseSchema = z.object({
  object: z.literal('list'),
  has_more: z.boolean().default(false),
  next_page: z.string().nullish(),
  data: z.array(scryfallSetSchema),
})
export type SetListResponse = z.infer<typeof setListResponseSchema>
