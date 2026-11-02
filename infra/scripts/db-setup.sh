#!/usr/bin/env bash
# Creates this project's roles and databases on the local Postgres container.
set -euo pipefail

container="${POSTGRES_CONTAINER:-postgres18}"

docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  < "$(dirname "$0")/../postgres/bootstrap.sql"

echo "Roles and databases are ready on $container."
