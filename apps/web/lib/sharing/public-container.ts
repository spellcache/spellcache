// Lecture publique d'un container. Ce fichier est le seul point où des données
// de collection quittent la zone authentifiée : la page `/s/<id>` est
// indexable, et une donnée privée qui y fuite est irréversible.
//
// Deux règles s'appliquent donc sans exception ici :
//
//  1. **La projection est construite champ par champ.** Aucun `select *`,
//     aucun `...row`, aucun objet de container/holding/utilisateur/ligne SQL
//     sérialisé tel quel. Les colonnes lues mais non projetées
//     (`legalities`, `color_identity`, `type_line`, `zone`, `is_commander`)
//     ne servent qu'au calcul de `status` et n'atteignent jamais l'objet
//     rendu — le composant serveur ne reçoit que `PublicContainer`, donc la
//     charge utile RSC de la page ne peut pas les porter.
//  2. **Rien de ce qui relève de la collection n'est lu.** Ni l'email du
//     propriétaire (seuls `username` et `price_source` sont sélectionnés sur
//     `users`), ni les quantités possédées ailleurs, ni les emplacements
//     manquants : `available`/`ownedElsewhere`/`state` n'existent pas dans
//     cette requête, ils ne peuvent donc pas être projetés par distraction.
//
// L'autorisation ne passe pas par `collection_members` — il n'y a pas de
// session : c'est `containers.visibility = 'public'` qui autorise, et le
// `kind` qui borne le partage aux decks et aux binders. Aucun second chemin
// d'autorisation n'est ouvert pour autant : la lecture est anonyme et
// strictement en lecture seule.
import { sql } from 'drizzle-orm'

import type { ContainerKind, DeckState, DeckZone, Legality, PriceSource } from '@spellcache/db/schema'
import { isGradientKey } from '@/lib/binders/gradients'
import { db } from '@spellcache/db'
import {
  evaluateDeck,
  isDeckFormat,
  type DeckEvaluationCard,
  type DeckFormat,
  type DeckStatus,
} from '@/lib/decks/legality'
import type { Currency } from '@/lib/format/money'
import { thumbUrl } from '@spellcache/core/images'
import { getCardArtist } from '@/lib/cards/artist'
import { currencyOf } from '@/lib/price-source'

export interface PublicCard {
  name: string
  // Quantité **dans ce container**, c'est-à-dire la liste elle-même — pas la
  // quantité possédée ailleurs dans la collection, qui n'est ni lue ni
  // projetée.
  qty: number
  manaCost: string | null
  setCode: string
  collectorNumber: string
  thumbUrl: string
  priceMinor: number | null
}

export interface PublicContainer {
  id: string
  kind: ContainerKind
  name: string
  coverArtUrl: string | null
  // Artiste de l'illustration de fond (lib/cards/artist.ts).
  coverArtist: string | null
  coverGradient: string | null
  format: DeckFormat | null
  status: DeckStatus | null
  valueMinor: number
  currency: Currency
  cards: PublicCard[]
  ownerUsername: string
}

interface HeaderRow extends Record<string, unknown> {
  id: string
  kind: ContainerKind
  name: string
  cover_card_id: string | null
  cover_gradient: string | null
  format: string | null
  deck_state: DeckState | null
  owner_username: string
  price_source: PriceSource
  value_usd_minor: string | number
  value_eur_minor: string | number
}

interface CardRow extends Record<string, unknown> {
  card_id: string
  name: string
  qty: number
  mana_cost: string | null
  set_code: string
  collector_number: string
  price_minor: string | number | null
  // Lues pour `evaluateDeck` uniquement — jamais projetées.
  zone: DeckZone
  is_commander: boolean
  legalities: Record<string, Legality>
  color_identity: string[]
  type_line: string
}

// Zone effective d'une ligne : `is_commander` fait foi sur `zone`,
// pour qu'un commandant reste en tête de liste même si une
// ligne écrite avant ce couplage porte encore `zone = 'main'`.
const ZONE_RANK: Record<DeckZone, number> = { commander: 0, main: 1, side: 2 }

function zoneOf(row: CardRow): DeckZone {
  return row.is_commander ? 'commander' : row.zone
}

export async function getPublicContainer(containerId: string): Promise<PublicContainer | null> {
  // `containerId` arrive d'un segment d'URL : le cast `::uuid` le fait
  // rejeter par Postgres si ce n'est pas un UUID. L'appelant (page.tsx)
  // valide en amont par Zod et répond 404 sans requête — cette garde-ci est
  // la seconde barrière, pas la première.
  const { rows: headerRows } = await db.execute<HeaderRow>(sql`
    select
      c.id as id,
      c.kind as kind,
      c.name as name,
      c.cover_card_id as cover_card_id,
      c.cover_gradient as cover_gradient,
      c.format as format,
      c.deck_state as deck_state,
      coalesce(u.username, '') as owner_username,
      u.price_source as price_source,
      coalesce(s.value_usd_minor, 0) as value_usd_minor,
      coalesce(s.value_eur_minor, 0) as value_eur_minor
    from containers c
    join collection_members m
      on m.collection_id = c.collection_id and m.role = 'owner'
    join users u on u.id = m.user_id
    left join container_stats s on s.container_id = c.id
    where c.id = ${containerId}::uuid
      and c.visibility = 'public'
      and c.kind in ('deck', 'binder')
    -- Une collection peut compter plusieurs propriétaires : sans ordre,
    -- le limit 1 ci-dessous rendrait un nom instable d'un chargement à
    -- l'autre, sur une page destinée à être indexée. Le plus anciennement
    -- rattaché fait foi ; u.id départage deux rattachements simultanés.
    order by m.added_at asc, u.id asc
    limit 1
  `)

  const header = headerRows[0]
  // `null`, jamais une exception : la page ne doit pas distinguer « privé »
  // de « inexistant » — les deux répondent 404, sinon l'URL devient un oracle
  // d'existence.
  if (!header) return null

  const currency = currencyOf({ priceSource: header.price_source })
  const nonfoil = currency === 'usd' ? sql`p.usd` : sql`p.eur`
  const foil = currency === 'usd' ? sql`p.usd_foil` : sql`p.eur_foil`

  const { rows: cardRows } = await db.execute<CardRow>(sql`
    select
      h.card_id as card_id,
      cd.name as name,
      h.qty as qty,
      cd.mana_cost as mana_cost,
      cd.set_code as set_code,
      cd.collector_number as collector_number,
      h.zone as zone,
      h.is_commander as is_commander,
      cd.legalities as legalities,
      cd.color_identity as color_identity,
      cd.type_line as type_line,
      round((case when h.finish = 'nonfoil' then ${nonfoil} else ${foil} end) * 100) as price_minor
    from holdings h
    join cards cd on cd.id = h.card_id
    left join lateral (
      select usd, usd_foil, eur, eur_foil from card_prices
      where card_prices.card_id = h.card_id
      order by day desc
      limit 1
    ) as p on true
    where h.container_id = ${containerId}::uuid
    order by
      case h.zone when 'commander' then 0 when 'main' then 1 else 2 end asc,
      cd.name asc,
      cd.set_code asc,
      cd.collector_number asc
  `)

  // Aucune copie par `...row` d'une ligne SQL, même interne : la zone
  // effective se lit par `zoneOf` (`is_commander` fait foi sur `zone`, même
  // règle que `getDeck`), et le tri se rejoue en JavaScript sur cette zone
  // effective. `Array#sort` est stable : l'ordre par nom déjà posé par
  // l'`order by` est conservé à l'intérieur de chaque zone.
  const ordered = [...cardRows].sort((a, b) => ZONE_RANK[zoneOf(a)] - ZONE_RANK[zoneOf(b)])

  const format = header.format && isDeckFormat(header.format) ? header.format : null
  const status = header.kind === 'deck' ? evaluateStatus(ordered, format, header.deck_state) : null

  const commanderRow = ordered.find((row) => row.is_commander) ?? null
  const coverCardId = header.cover_card_id ?? commanderRow?.card_id ?? null
  const gradient = header.cover_gradient

  return {
    id: header.id,
    kind: header.kind,
    name: header.name,
    // L'URL passe par le proxy interne de vignettes (`packages/core/src/images.ts`) : elle
    // n'est jamais construite à la main, et le recadrage `art_crop` est
    // celui livré par le fichier bulk (docs/development.md).
    coverArtUrl: coverCardId ? thumbUrl(coverCardId, 'art_crop') : null,
    coverArtist: await getCardArtist(coverCardId),
    // Validé contre les six clés de la palette plutôt que renvoyé tel
    // quel : la page publique n'interpole une valeur venue de la base dans
    // un style que si elle appartient au domaine connu.
    coverGradient: gradient && isGradientKey(gradient) ? gradient : null,
    format,
    status,
    valueMinor: Number(currency === 'usd' ? header.value_usd_minor : header.value_eur_minor),
    currency,
    cards: ordered.map((row) => ({
      name: row.name,
      qty: row.qty,
      manaCost: row.mana_cost,
      setCode: row.set_code,
      collectorNumber: row.collector_number,
      thumbUrl: thumbUrl(row.card_id, 'small'),
      priceMinor: row.price_minor === null ? null : Number(row.price_minor),
    })),
    ownerUsername: header.owner_username,
  }
}

// Reprend mot pour mot la règle de `getDeck` : le côté n'entre jamais
// dans la légalité (un sideboard n'est soumis ni à la taille ni au
// singleton), et `deck_state` retombe sur `plan` quand la colonne est nulle.
function evaluateStatus(
  rows: CardRow[],
  format: DeckFormat | null,
  deckState: DeckState | null,
): DeckStatus {
  const legalityRows = rows.filter((row) => zoneOf(row) !== 'side')
  const cards: DeckEvaluationCard[] = legalityRows.map((row) => ({
    cardId: row.card_id,
    name: row.name,
    qty: row.qty,
    legalities: row.legalities,
    colorIdentity: row.color_identity,
    typeLine: row.type_line,
  }))
  const commander = rows.find((row) => row.is_commander) ?? null

  return evaluateDeck({
    format,
    deckState: deckState ?? 'plan',
    cards,
    commander: commander ? { colorIdentity: commander.color_identity } : null,
  })
}

// Carte de couverture d'un container public, pour l'image Open Graph
// (`app/(public)/s/[containerId]/opengraph-image.tsx`). Même priorité que
// l'écran connecté (`components/decks/deck-backdrop.tsx`) : la dérogation explicite
// `cover_card_id` d'abord, le commandant ensuite.
//
// Retourne `null` si le container n'est pas partagé — la route d'image doit
// répondre 404 exactement comme la page, sinon l'illustration d'un deck
// repassé privé resterait accessible par son URL d'image.
export async function getPublicCoverCard(
  containerId: string,
): Promise<{ coverCardId: string | null } | null> {
  const { rows } = await db.execute<{ cover_card_id: string | null }>(sql`
    select coalesce(c.cover_card_id, cm.card_id) as cover_card_id
    from containers c
    left join lateral (
      select h.card_id from holdings h
      where h.container_id = c.id and h.is_commander
      limit 1
    ) as cm on true
    where c.id = ${containerId}::uuid
      and c.visibility = 'public'
      and c.kind in ('deck', 'binder')
    limit 1
  `)

  const row = rows[0]
  if (!row) return null
  return { coverCardId: row.cover_card_id }
}
