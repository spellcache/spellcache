// Schéma Drizzle — catalogue Scryfall, comptes et tables de collection
// (`containers`, `holdings`, …).
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

import type { ScryfallImageUris } from '@spellcache/core/scryfall/schemas'

export type Legality = 'legal' | 'not_legal' | 'restricted' | 'banned'

// Drizzle n'a pas de type de colonne `tsvector` natif : on le déclare via
// `customType` pour que la migration générée porte le bon type Postgres. La
// colonne est calculée par Postgres (`GENERATED ALWAYS AS ... STORED`, voir
// la migration) — jamais assignée depuis le code, sinon l'upsert la
// désynchronise.
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

export const sets = pgTable('sets', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  releasedAt: date('released_at'),
  iconSvgUri: text('icon_svg_uri'),
  cardCount: integer('card_count').notNull(),
  // `set_type` Scryfall (`token`, `memorabilia`, `expansion`…), agrégé par
  // l'import bulk depuis les cartes du set. Nullable : les lignes d'avant la
  // migration 0017 restent NULL jusqu'au prochain import — tout filtre doit
  // être NULL-sûr (« Ignore Tokens and Art Series », demande produit).
  setType: text('set_type'),
})

export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey(), // Scryfall card id
    oracleId: uuid('oracle_id').notNull(),
    name: text('name').notNull(),
    setCode: text('set_code')
      .notNull()
      .references(() => sets.code),
    collectorNumber: text('collector_number').notNull(),
    rarity: text('rarity').notNull(),
    manaCost: text('mana_cost'),
    cmc: numeric('cmc').notNull(),
    typeLine: text('type_line').notNull(),
    oracleText: text('oracle_text'),
    colors: text('colors').array().notNull(),
    colorIdentity: text('color_identity').array().notNull(),
    finishes: text('finishes').array().notNull(),
    imageUris: jsonb('image_uris').$type<ScryfallImageUris>(),
    legalities: jsonb('legalities').$type<Record<string, Legality>>().notNull(),
    artist: text('artist'),
    // `layout` Scryfall (`normal`, `token`, `double_faced_token`,
    // `art_series`…) — porte le filtre « Ignore Tokens and Art Series »
    // (demande produit). Nullable : NULL avant le premier import qui suit
    // la migration 0017, les filtres restent NULL-sûrs.
    layout: text('layout'),
    // tsvector, généré en SQL — voir customType `tsvector` ci-dessus.
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('simple', name || ' ' || type_line || ' ' || coalesce(oracle_text, ''))`,
    ),
  },
  (table) => [
    index('cards_search_vector_idx').using('gin', table.searchVector),
    // pg_trgm génère des trigrammes déjà repliés en casse (c'est ce qui
    // permet à `gin_trgm_ops` d'accélérer aussi `ILIKE` sans index dédié) :
    // `similarity()`/`%` sont donc insensibles à la casse sur cet index tel
    // quel — pas besoin d'un second index sur `lower(name)` (la recherche
    // utilise directement `cards.name % $1`).
    index('cards_name_trgm_idx').using('gin', table.name.op('gin_trgm_ops')),
  ],
)

export const cardPrices = pgTable(
  'card_prices',
  {
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    day: date('day').notNull(),
    eur: numeric('eur'),
    eurFoil: numeric('eur_foil'),
    usd: numeric('usd'),
    usdFoil: numeric('usd_foil'),
  },
  (table) => [
    primaryKey({ columns: [table.cardId, table.day] }),
    // La clé primaire `(card_id, day)` porte `card_id` en tête : elle ne sert
    // pas une lecture par `day` seul (lecture de J-7), utilisée par
    // `apps/worker/src/jobs/revalue-containers.ts` pour résoudre le jour de
    // référence et le jour de comparaison.
    index('card_prices_day_idx').on(table.day),
  ],
)

export const importRuns = pgTable('import_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull(), // ex. 'default_cards', 'revalue-containers'
  // Nullable : ne porte de sens que pour
  // `source = 'default_cards'` (l'`updated_at` du fichier bulk). Les
  // lignes `source = 'revalue-containers'` n'ont pas de fichier bulk associé
  // — les y remplir avec `startedAt` ferait dire deux choses différentes à
  // la même colonne et dupliquerait `startedAt`, déjà porté par
  // `started_at`.
  bulkUpdatedAt: timestamp('bulk_updated_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  rowsUpserted: integer('rows_upserted').notNull().default(0),
  status: text('status').notNull(), // 'running' | 'success' | 'error'
  // Une ligne `status = 'error'` porte le message d'erreur. Nullable : les
  // lignes `success` n'en portent jamais.
  errorMessage: text('error_message'),
})

export type Card = typeof cards.$inferSelect
export type Set = typeof sets.$inferSelect
export type CardPrice = typeof cardPrices.$inferSelect
export type ImportRun = typeof importRuns.$inferSelect

// Comptes — Auth.js v5, adapter Drizzle (`@auth/drizzle-adapter`).
export type UserRole = 'admin' | 'member'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // `name`/`image` : non exploitées par spellcache (l'identité publique passe
  // par `username`/`displayName`), mais exigées par la forme
  // `DefaultPostgresUsersTable` de l'adapter Drizzle — leur absence casse le
  // typage de `DrizzleAdapter(db, { usersTable: users, ... })`.
  name: text('name'),
  image: text('image'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified'),
  // Nullable tant que l'onboarding n'est pas fait. Stocké en minuscules
  // (validé par `usernameSchema`) : l'unicité insensible à la casse tient sur
  // cet index, pas sur `lower(username)`.
  username: text('username').unique(),
  displayName: text('display_name'),
  role: text('role').$type<UserRole>().notNull().default('member'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  // Préférences de compte — jamais dans le
  // navigateur (docs/development.md), pour que mobile et desktop concordent.
  collectionStyle: text('collection_style').$type<LayoutStyle>().notNull().default('compact'),
  density: text('density').$type<Density>().notNull().default('compact'),
  previewPane: boolean('preview_pane').notNull().default(true),
  pricesOnArt: boolean('prices_on_art').notNull().default(true),
  binderBackdrops: boolean('binder_backdrops').notNull().default(true),
  // Unique source de vérité pour la devise/le marché (docs/development.md) — aucun
  // second réglage de devise ni taux de change n'existe dans l'app.
  priceSource: text('price_source').$type<PriceSource>().notNull().default('cardmarket_eur'),
  // Outils de table : le seul outil réellement livré. `false` par défaut —
  // l'onglet `Tools` reste absent de la barre tant qu'aucun outil n'est
  // actif, et les comptes créés avant cette colonne héritent du même défaut
  // via le `DEFAULT false NOT NULL` de la migration : aucune ligne
  // existante ne se retrouve avec un outil activé sans l'avoir demandé.
  toolLifeTracker: boolean('tool_life_tracker').notNull().default(false),
  // État replié/déplié de l'arbre de la barre latérale desktop : il survit à
  // une reconnexion. Une préférence de compte comme les autres — jamais
  // `localStorage` (docs/development.md). Porte les nœuds **repliés**, pas les
  // dépliés : le défaut `'[]'::jsonb` de la migration signifie donc « tout
  // déplié », ce qui est exactement ce que montre le design validé
  // (sous-arbre de `Collection` ouvert) — tous les comptes créés avant cette
  // colonne héritent de ce défaut sans backfill, et aucun d'eux ne se
  // retrouve avec un arbre fermé qu'il n'a pas demandé.
  sidebarCollapsed: jsonb('sidebar_collapsed').$type<SidebarNodeKey[]>().notNull().default([]),
  // Couleur d'accent de l'interface et fond noir pur (OLED). Préférences de
  // compte comme les autres, jamais `localStorage` (docs/development.md) : le
  // layout racine les pose en attributs sur `<html>` dès le rendu serveur,
  // donc aucun flash de l'accent par défaut au chargement.
  accentColor: text('accent_color').$type<AccentColor>().notNull().default('gold'),
  pureBlack: boolean('pure_black').notNull().default(false),
  // Clair/sombre : `dark` par défaut (l'app est née sombre — aucun compte
  // existant ne bascule sans l'avoir demandé), `system` suit l'OS.
  colorScheme: text('color_scheme').$type<ColorScheme>().notNull().default('dark'),
  // Collection affichée (multi-collection) : un compte peut être membre de
  // plusieurs collections et choisit celle qu'il consulte. Une préférence de
  // compte comme les autres, jamais `localStorage` (docs/development.md). `null` ou une
  // collection dont il n'est plus membre retombent sur sa première adhésion
  // (`lib/collections/active.ts`) — jamais un chemin d'autorisation : l'accès
  // passe toujours par `collection_members`.
  activeCollectionId: uuid('active_collection_id').references((): AnyPgColumn => collections.id, {
    onDelete: 'set null',
  }),
})

// Les deux seuls nœuds repliables de l'arbre de la barre latérale : le
// sous-arbre des containers sous `Collection`, et les dossiers de decks
// sous `Decks`. Une énumération fermée plutôt qu'un
// identifiant libre — un id de container supprimé traînerait sinon
// indéfiniment dans la préférence.
export type SidebarNodeKey = 'collection' | 'decks'

export type LayoutStyle = 'compact' | 'shelves'
export type Density = 'rows' | 'compact' | 'grid'
export type PriceSource = 'tcgplayer_usd' | 'cardmarket_eur'
export const ACCENT_COLORS = ['gold', 'blue', 'violet', 'silver'] as const
export type AccentColor = (typeof ACCENT_COLORS)[number]
export const COLOR_SCHEMES = ['system', 'light', 'dark'] as const
export type ColorScheme = (typeof COLOR_SCHEMES)[number]

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })],
)

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
})

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
    // Essais de connexion depuis l'envoi de ce code (lien ou code à 6
    // chiffres) : au-delà de la limite, les codes en attente de l'email sont
    // révoqués (lib/auth/login-attempts.ts) — un code à 6 chiffres ne tient
    // que si on ne peut pas tous les essayer. Ignorée par l'adapter Auth.js.
    attempts: integer('attempts').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
)

export type User = typeof users.$inferSelect
export type Account = typeof accounts.$inferSelect
export type Session = typeof sessions.$inferSelect
export type VerificationToken = typeof verificationTokens.$inferSelect

// Collections partagées, containers & holdings — modèle unique pour la
// collection, les binders, les decks et les listes (docs/development.md, Key
// architectural decisions). Les `containers` pointent vers une collection,
// jamais vers un compte : la propriété passe uniquement par
// `collection_members`, seul chemin d'autorisation.
export const collections = pgTable('collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// `viewer` (multi-collection, étape 2) : lecture seule — voit tout le
// contenu de la collection, n'écrit rien (lib/collections/authorize.ts).
export type MemberRole = 'owner' | 'editor' | 'viewer'

export const collectionMembers = pgTable(
  'collection_members',
  {
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<MemberRole>().notNull(),
    addedAt: timestamp('added_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.userId] }),
    // Plus d'unicité sur `user_id` (multi-collection) : un compte peut
    // appartenir à plusieurs collections. Index simple pour la résolution
    // « mes collections » (`lib/collections/active.ts`).
    index('collection_members_user_id_idx').on(table.userId),
  ],
)

export type ContainerKind = 'collection' | 'binder' | 'deck' | 'list'
export type Visibility = 'private' | 'public'
export type DeckState = 'plan' | 'assemble' | 'built' | 'dismantled'

// Dossiers de decks : un seul niveau, aucun emboîtement (pas de `parent_id`
// ici, et l'ajouter serait un défaut, pas une amélioration). Rattachés à la
// collection, jamais à un `user_id` : une collection est un espace partagé et
// `collection_members` reste l'unique chemin d'autorisation
// (docs/development.md). L'ordre des dossiers est propre à la collection.
export const deckFolders = pgTable(
  'deck_folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Réécrite pour tous les dossiers de la collection à chaque
    // réordonnancement (sinon deux dossiers finissent avec la même
    // valeur) — pas de contrainte d'unicité en base, un
    // réordonnancement transitoire passerait forcément par un doublon
    // intermédiaire dans la même transaction.
    position: integer('position').notNull(),
  },
  (table) => [index('deck_folders_collection_id_idx').on(table.collectionId)],
)

export const containers = pgTable(
  'containers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<ContainerKind>().notNull(),
    name: text('name').notNull(),
    coverCardId: uuid('cover_card_id').references(() => cards.id),
    coverGradient: text('cover_gradient'),
    coverIntensity: numeric('cover_intensity').notNull().default('0.52'),
    visibility: text('visibility').$type<Visibility>().notNull().default('private'),
    // Notes libres, éditées par l'onglet `Infos` d'un deck : ce qu'on veut
    // se rappeler d'une liste (conditions de victoire, lignes à chercher,
    // cartes à échanger). Nullable et vide par défaut — la colonne vit sur
    // `containers` comme le reste, aucune table dédiée pour un champ texte.
    description: text('description'),
    // `null` hors des decks : `deckState`/`format` ne concernent que les
    // decks, `folderId` que les decks rangés dans un dossier.
    deckState: text('deck_state').$type<DeckState | null>(),
    format: text('format'),
    // `folder_id` nullable. `ON DELETE SET NULL` garantit que supprimer un
    // dossier de 5 decks laisse les 5 decks intacts, `folder_id` à `null`,
    // donc dans `Unsorted`. Tous les decks écrits avant les dossiers portent
    // `null` et tombent donc dans `Unsorted` sans backfill.
    folderId: uuid('folder_id').references(() => deckFolders.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [index('containers_collection_id_idx').on(table.collectionId)],
)

export type Finish = 'nonfoil' | 'foil' | 'etched'
export type Condition = 'nm' | 'lp' | 'mp' | 'hp' | 'dmg'
// Zone d'un holding de deck : `main`/`side`/`commander`. Portée par `holdings`
// plutôt qu'une colonne propre à `containers` (un `container` n'a qu'un seul
// `kind`, une seule ligne) — chaque carte d'un deck choisit sa propre zone,
// indépendamment des autres. Défaut `main` : tout holding non-deck (collection
// racine, binder, liste) reste sur cette valeur sans jamais la lire ni
// l'écrire.
export type DeckZone = 'main' | 'side' | 'commander'

export const holdings = pgTable(
  'holdings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    containerId: uuid('container_id')
      .notNull()
      .references(() => containers.id, { onDelete: 'cascade' }),
    // Jamais `{ onDelete: 'cascade' }` ici : supprimer une
    // carte du catalogue (reconstructible) ne doit jamais effacer des
    // données de compte (irremplaçables, docs/development.md).
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    qty: integer('qty').notNull(),
    finish: text('finish').$type<Finish>().notNull().default('nonfoil'),
    condition: text('condition').$type<Condition>().notNull().default('nm'),
    language: text('language').notNull().default('en'),
    // Note libre par ligne (éditée par `EditCardSheet`/`EditListCardSheet`) :
    // « signed », « for trade »… `null` = pas de note, jamais de chaîne vide.
    notes: text('notes'),
    isCommander: boolean('is_commander').notNull().default(false),
    zone: text('zone').$type<DeckZone>().notNull().default('main'),
    addedAt: timestamp('added_at').notNull().defaultNow(),
  },
  (table) => [
    index('holdings_container_card_finish_idx').on(
      table.containerId,
      table.cardId,
      table.finish,
    ),
  ],
)

export const containerStats = pgTable('container_stats', {
  containerId: uuid('container_id')
    .primaryKey()
    .references(() => containers.id, { onDelete: 'cascade' }),
  cardCount: integer('card_count').notNull(),
  uniqueCount: integer('unique_count').notNull(),
  // Entier de centimes : un `numeric` flottant accumulerait les erreurs
  // d'arrondi sur des milliers de lignes.
  valueUsdMinor: bigint('value_usd_minor', { mode: 'number' }).notNull(),
  valueEurMinor: bigint('value_eur_minor', { mode: 'number' }).notNull(),
  // Remplies par la revalorisation quotidienne ; `null` avant son premier
  // passage.
  deltaUsd7d: numeric('delta_usd_7d'),
  deltaEur7d: numeric('delta_eur_7d'),
  computedAt: timestamp('computed_at').notNull().defaultNow(),
})

// Traçabilité des imports de liste : chaque import écrit une ligne
// `import_lists` (container, compte, nombre de lignes, date).
// Journal, pas un chemin d'autorisation : `user_id` répond ici à « qui a
// collé cette liste », jamais à « qui a le droit d'écrire dans ce
// container » — cette question ne se pose qu'à `collection_members`
// (docs/development.md, `lib/collections/authorize.ts`). L'anti-pattern de docs/development.md
// vise `containers.user_id`, la propriété d'un container ; une ligne de
// journal nommant son auteur n'ouvre aucun second chemin de lecture, et
// aucune requête de ce projet ne joint `import_lists` pour autoriser quoi
// que ce soit.
//
// `on delete cascade` des deux côtés : supprimer un container ou un
// compte ne doit pas laisser une ligne de journal orpheline pointant
// vers un id disparu.
export const importLists = pgTable(
  'import_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    containerId: uuid('container_id')
      .notNull()
      .references(() => containers.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Nombre de lignes de carte réellement écrites, pas le nombre de lignes
    // du texte collé (les lignes vides, les en-têtes de section et les noms
    // inconnus n'écrivent rien).
    lineCount: integer('line_count').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('import_lists_container_id_idx').on(table.containerId)],
)

// Réglages du site (une seule ligne, `id = 1`), édités par un admin dans
// Administration › Users. `signup_mode` : `invite` (défaut) — seuls les
// comptes existants ou invités reçoivent un lien magique, sauf le tout
// premier compte d'une base vide (qui devient admin, lib/auth.ts) ; `open`
// — n'importe quel email peut créer un compte.
export type SignupMode = 'invite' | 'open'

export const siteSettings = pgTable('site_settings', {
  id: integer('id').primaryKey().default(1),
  signupMode: text('signup_mode').$type<SignupMode>().notNull().default('invite'),
})

export type Collection = typeof collections.$inferSelect
export type CollectionMember = typeof collectionMembers.$inferSelect
export type DeckFolder = typeof deckFolders.$inferSelect
export type Container = typeof containers.$inferSelect
export type Holding = typeof holdings.$inferSelect
export type ContainerStatsRow = typeof containerStats.$inferSelect
export type ImportList = typeof importLists.$inferSelect
