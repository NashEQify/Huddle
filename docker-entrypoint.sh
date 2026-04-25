#!/bin/sh
set -e

echo "[entrypoint] Running Prisma migrations..."
npx prisma migrate deploy

echo "[entrypoint] Running database seed (idempotent)..."
npx prisma db seed 2>/dev/null || echo "[entrypoint] Seed skipped or already applied"

echo "[entrypoint] Starting application..."
exec "$@"
