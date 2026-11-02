-- pg-boss installs into this schema as the owner (ADR-005). Default privileges
-- cover what it creates, now and on upgrades, so there are no grant lists.
-- DELETE is for pg-boss's own retention; application tables stay without it.

CREATE SCHEMA pgboss;
--> statement-breakpoint

GRANT USAGE ON SCHEMA pgboss TO comprobify_erp_app;
--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO comprobify_erp_app;
--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  GRANT USAGE, SELECT ON SEQUENCES TO comprobify_erp_app;
