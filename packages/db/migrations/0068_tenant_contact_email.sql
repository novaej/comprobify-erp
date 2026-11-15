-- ADR-040: where replies to emails sent for a company go. A plain nullable column, no CHECK or
-- foreign key over rows, so no system context is needed.
ALTER TABLE "tenants" ADD COLUMN "contact_email" text;
