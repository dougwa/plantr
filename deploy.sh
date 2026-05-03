#!/usr/bin/env bash
# Pull the latest main, rebuild, and restart the stack.
# Run from /opt/plantr on the droplet.
set -euo pipefail

cd "$(dirname "$0")"

echo "==> git pull"
git pull --ff-only

echo "==> docker compose build"
docker compose build

echo "==> docker compose up -d"
docker compose up -d

echo "==> docker compose ps"
docker compose ps
