-- Local roles and databases, safe to re-run. Production: docs/deployment.md.
-- Roles are cluster-wide and postgres18 is shared, so names stay project-specific.
-- The passwords are local placeholders, matching .env.example.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'comprobify_owner') THEN
    CREATE ROLE comprobify_owner LOGIN PASSWORD 'changeme'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'comprobify_app') THEN
    CREATE ROLE comprobify_app LOGIN PASSWORD 'changeme'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

SELECT format('CREATE DATABASE %I OWNER comprobify_owner', name)
FROM unnest(ARRAY['comprobify_local', 'comprobify_test', 'comprobify_e2e']) AS name
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = name)
\gexec

-- Other projects' roles share this cluster.
REVOKE ALL ON DATABASE comprobify_local, comprobify_test, comprobify_e2e FROM PUBLIC;
GRANT CONNECT ON DATABASE comprobify_local, comprobify_test, comprobify_e2e TO comprobify_app;
