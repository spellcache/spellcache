-- `gin_trgm_ops` (recherche tolérante aux fautes sur `cards.name`) exige
-- cette extension : Drizzle n'a pas de helper pour la déclarer, elle est
-- ajoutée à la main après `drizzle-kit generate`.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "card_prices" (
	"card_id" uuid NOT NULL,
	"day" date NOT NULL,
	"eur" numeric,
	"eur_foil" numeric,
	"usd" numeric,
	"usd_foil" numeric,
	CONSTRAINT "card_prices_card_id_day_pk" PRIMARY KEY("card_id","day")
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"oracle_id" uuid NOT NULL,
	"name" text NOT NULL,
	"set_code" text NOT NULL,
	"collector_number" text NOT NULL,
	"rarity" text NOT NULL,
	"mana_cost" text,
	"cmc" numeric NOT NULL,
	"type_line" text NOT NULL,
	"oracle_text" text,
	"colors" text[] NOT NULL,
	"color_identity" text[] NOT NULL,
	"finishes" text[] NOT NULL,
	"image_uris" jsonb,
	"legalities" jsonb NOT NULL,
	"artist" text,
	"layout" text,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', name || ' ' || type_line || ' ' || coalesce(oracle_text, ''))) STORED
);
--> statement-breakpoint
CREATE TABLE "collection_members" (
	"collection_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "collection_members_collection_id_user_id_pk" PRIMARY KEY("collection_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_stats" (
	"container_id" uuid PRIMARY KEY NOT NULL,
	"card_count" integer NOT NULL,
	"unique_count" integer NOT NULL,
	"value_usd_minor" bigint NOT NULL,
	"value_eur_minor" bigint NOT NULL,
	"delta_usd_7d" numeric,
	"delta_eur_7d" numeric,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "containers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"cover_card_id" uuid,
	"cover_gradient" text,
	"cover_intensity" numeric DEFAULT '0.52' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"description" text,
	"deck_state" text,
	"format" text,
	"folder_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deck_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"container_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"finish" text DEFAULT 'nonfoil' NOT NULL,
	"condition" text DEFAULT 'nm' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"notes" text,
	"is_commander" boolean DEFAULT false NOT NULL,
	"zone" text DEFAULT 'main' NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"container_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"line_count" integer NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"bulk_updated_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"rows_upserted" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"released_at" date,
	"icon_svg_uri" text,
	"card_count" integer NOT NULL,
	"set_type" text
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"signup_mode" text DEFAULT 'invite' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"image" text,
	"email" text NOT NULL,
	"email_verified" timestamp,
	"username" text,
	"display_name" text,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"collection_style" text DEFAULT 'compact' NOT NULL,
	"density" text DEFAULT 'compact' NOT NULL,
	"preview_pane" boolean DEFAULT true NOT NULL,
	"prices_on_art" boolean DEFAULT true NOT NULL,
	"binder_backdrops" boolean DEFAULT true NOT NULL,
	"price_source" text DEFAULT 'cardmarket_eur' NOT NULL,
	"tool_life_tracker" boolean DEFAULT false NOT NULL,
	"sidebar_collapsed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accent_color" text DEFAULT 'gold' NOT NULL,
	"pure_black" boolean DEFAULT false NOT NULL,
	"color_scheme" text DEFAULT 'dark' NOT NULL,
	"active_collection_id" uuid,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_prices" ADD CONSTRAINT "card_prices_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_set_code_sets_code_fk" FOREIGN KEY ("set_code") REFERENCES "public"."sets"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_members" ADD CONSTRAINT "collection_members_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_members" ADD CONSTRAINT "collection_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_stats" ADD CONSTRAINT "container_stats_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_cover_card_id_cards_id_fk" FOREIGN KEY ("cover_card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_folder_id_deck_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."deck_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_folders" ADD CONSTRAINT "deck_folders_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_lists" ADD CONSTRAINT "import_lists_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_lists" ADD CONSTRAINT "import_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_active_collection_id_collections_id_fk" FOREIGN KEY ("active_collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_prices_day_idx" ON "card_prices" USING btree ("day");--> statement-breakpoint
CREATE INDEX "cards_search_vector_idx" ON "cards" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "cards_name_trgm_idx" ON "cards" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "collection_members_user_id_idx" ON "collection_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "containers_collection_id_idx" ON "containers" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "deck_folders_collection_id_idx" ON "deck_folders" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "holdings_container_card_finish_idx" ON "holdings" USING btree ("container_id","card_id","finish");--> statement-breakpoint
CREATE INDEX "import_lists_container_id_idx" ON "import_lists" USING btree ("container_id");