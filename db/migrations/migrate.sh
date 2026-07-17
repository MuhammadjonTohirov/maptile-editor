#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

for migration in /migrations/[0-9]*.sql; do
  [ -e "$migration" ] || continue
  version=$(basename "$migration")
  applied=$(psql -At -v ON_ERROR_STOP=1 -c "SELECT 1 FROM schema_migrations WHERE version = '$version'")
  if [ "$applied" != "1" ]; then
    echo "Applying $version"
    psql -v ON_ERROR_STOP=1 -f "$migration"
    psql -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations (version) VALUES ('$version')"
  fi
done
