#!/usr/bin/env bash
set -euo pipefail

integration_db="maptile_editor_integration_${RANDOM}_$$"

cleanup() {
  docker compose exec -T db dropdb -U postgres --if-exists "$integration_db" >/dev/null
}
trap cleanup EXIT

docker compose exec -T db createdb -U postgres "$integration_db"

for migration in db/migrations/[0-9]*.sql; do
  docker compose exec -T db \
    psql -U postgres -d "$integration_db" -v ON_ERROR_STOP=1 \
    < "$migration" >/dev/null
done

docker compose --profile test build backend-tests

TEST_DATABASE_URL="postgresql+asyncpg://postgres:postgres@db:5432/$integration_db" \
RUN_DB_INTEGRATION=1 \
  docker compose --profile test run --rm --no-deps backend-tests
