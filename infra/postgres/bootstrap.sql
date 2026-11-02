-- Local roles and databases, safe to re-run. Production: docs/deployment.md.
-- Roles are cluster-wide and postgres18 is shared, so names stay project-specific.
-- The passwords are local placeholders, matching .env.example.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'comprobify_erp_owner') THEN
    CREATE ROLE comprobify_erp_owner LOGIN PASSWORD 'changeme'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'comprobify_erp_app') THEN
    CREATE ROLE comprobify_erp_app LOGIN PASSWORD 'changeme'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

SELECT format('CREATE DATABASE %I OWNER comprobify_erp_owner', name)
FROM unnest(ARRAY['comprobify_erp_local', 'comprobify_erp_test']) AS name
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = name)
\gexec

-- Other projects' roles share this cluster.
REVOKE ALL ON DATABASE comprobify_erp_local, comprobify_erp_test FROM PUBLIC;
GRANT CONNECT ON DATABASE comprobify_erp_local, comprobify_erp_test TO comprobify_erp_app;
