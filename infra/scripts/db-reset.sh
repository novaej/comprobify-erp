#!/usr/bin/env bash
# Drops and recreates this project's databases on the local Postgres container, then
# migrates them. Local only: it knows three names and talks to the container directly.
#   pnpm db:reset e2e          # the E2E and Docker stack database
#   pnpm db:reset test         # the integration tests' database
#   pnpm db:reset local        # the one `pnpm dev` uses; asks to confirm
#   pnpm db:reset all [--yes]
set -euo pipefail

container="${POSTGRES_CONTAINER:-postgres18}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
target="${1:-}"
confirmed="${2:-}"

case "$target" in
  local | test | e2e) names=("$target") ;;
  all) names=(local test e2e) ;;
  *)
    echo "Usage: pnpm db:reset <local|test|e2e|all> [--yes]" >&2
    exit 1
    ;;
esac

# The data you work with: dropped only when the name is typed, or with --yes.
for name in "${names[@]}"; do
  if [[ "$name" == local && "$confirmed" != --yes ]]; then
    read -r -p "This deletes everything in comprobify_erp_local. Type 'local' to confirm: " answer
    [[ "$answer" == local ]] || { echo "Nothing was reset." >&2; exit 1; }
  fi
done

# Each database's owner URL: from the environment or .env, else the .env.example default.
if [[ -f "$root/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$root/.env"
  set +a
fi
owner_url() {
  local fallback="postgres://comprobify_erp_owner:changeme@localhost:5432/comprobify_erp_$1"
  case "$1" in
    local) echo "${MIGRATION_DATABASE_URL:-$fallback}" ;;
    test) echo "${TEST_MIGRATION_DATABASE_URL:-$fallback}" ;;
    e2e) echo "${E2E_MIGRATION_DATABASE_URL:-$fallback}" ;;
  esac
}

for name in "${names[@]}"; do
  database="comprobify_erp_$name"
  url="$(owner_url "$name")"
  # The URL must name the database being reset, so a stray .env can't migrate another.
  [[ "$url" == */"$database" ]] || { echo "Owner URL for $name doesn't end in /$database" >&2; exit 1; }
  docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS $database WITH (FORCE)"
  docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
    < "$root/infra/postgres/bootstrap.sql"
  (cd "$root" && MIGRATION_DATABASE_URL="$url" LOG_LEVEL=warn \
    pnpm --silent --filter @comprobify/worker db:migrate)
  echo "Reset $database."
done
