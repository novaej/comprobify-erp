-- FR-PUR-3: who the order was last emailed to, and when.
ALTER TABLE "purchase_orders" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "emailed_to" text[];