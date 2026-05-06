#!/bin/sh
set -e

echo "==> Pushing Prisma schema to database..."
npx prisma db push

echo "==> Starting application..."
if [ "$PROCESS_TYPE" = "worker" ]; then
  echo "==> Starting BullMQ worker process..."
  exec node app/queues/worker.js
else
  echo "==> Starting web server on port ${PORT:-3000}..."
  exec npx remix-serve ./build/server/index.js
fi
