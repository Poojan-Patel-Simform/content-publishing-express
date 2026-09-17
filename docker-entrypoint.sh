#!/bin/sh
# Render's Pre-Deploy Command — the correct home for `migrate deploy` — is a
# paid-plan feature, so on the free instance type the migration has to run at
# container start instead. `migrate deploy` takes a Postgres advisory lock, so
# two instances booting at once serialise rather than corrupt anything; the
# second one waits, then finds nothing to apply.
set -e

echo "[entrypoint] applying database migrations"
npx prisma migrate deploy

echo "[entrypoint] starting app"
exec "$@"
