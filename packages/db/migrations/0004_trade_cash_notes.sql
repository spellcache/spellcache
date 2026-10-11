ALTER TABLE "trades" ADD COLUMN "initiator_cash_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "counterparty_cash_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "initiator_notes" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "counterparty_notes" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "counterparty_joined_at" timestamp with time zone;