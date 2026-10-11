CREATE TABLE "trade_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"giver" text NOT NULL,
	"card_id" uuid NOT NULL,
	"finish" text NOT NULL,
	"condition" text NOT NULL,
	"language" text NOT NULL,
	"qty" integer NOT NULL,
	"holding_id" uuid,
	"price_override_minor" integer,
	"unit_price_minor" integer,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"mode" text NOT NULL,
	"currency" text NOT NULL,
	"initiator_id" uuid,
	"initiator_name" text NOT NULL,
	"initiator_collection_id" uuid,
	"initiator_container_id" uuid,
	"counterparty_id" uuid,
	"counterparty_name" text NOT NULL,
	"counterparty_collection_id" uuid,
	"counterparty_container_id" uuid,
	"initiator_rate_pct" integer DEFAULT 100 NOT NULL,
	"counterparty_rate_pct" integer DEFAULT 100 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"initiator_accepted_revision" integer,
	"counterparty_accepted_revision" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tool_trading_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_lines" ADD CONSTRAINT "trade_lines_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_lines" ADD CONSTRAINT "trade_lines_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_lines" ADD CONSTRAINT "trade_lines_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_initiator_collection_id_collections_id_fk" FOREIGN KEY ("initiator_collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_initiator_container_id_containers_id_fk" FOREIGN KEY ("initiator_container_id") REFERENCES "public"."containers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_counterparty_id_users_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_counterparty_collection_id_collections_id_fk" FOREIGN KEY ("counterparty_collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_counterparty_container_id_containers_id_fk" FOREIGN KEY ("counterparty_container_id") REFERENCES "public"."containers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trade_lines_trade_id_idx" ON "trade_lines" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX "trades_initiator_id_idx" ON "trades" USING btree ("initiator_id");--> statement-breakpoint
CREATE INDEX "trades_counterparty_id_idx" ON "trades" USING btree ("counterparty_id");