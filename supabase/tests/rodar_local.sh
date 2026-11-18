#!/usr/bin/env bash
# Testa as migrations num Postgres local (não precisa de Supabase).
# Uso: PGUSER=postgres ./supabase/tests/rodar_local.sh
set -euo pipefail
cd "$(dirname "$0")"
BANCO="${BANCO:-pbr_teste}"
dropdb --if-exists "$BANCO" && createdb "$BANCO"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f 00_stubs_supabase.sql
for m in ../migrations/*.sql; do
  echo "== aplicando $m (2x para conferir idempotência)"
  psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$m"
  psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$m"
done
for t in [0-9][0-9]_*_test.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$t"
done
