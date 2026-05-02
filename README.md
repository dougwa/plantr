# PlantR

Plant management platform for tracking a large home plant collection. See `overview.md` for the product spec.

## Stack

- **apps/api** — Node.js + Fastify + Prisma + Postgres
- **apps/web** — Next.js (App Router) + TypeScript + Tailwind
- **apps/mobile** — Expo (React Native) + TypeScript

Monorepo managed with pnpm workspaces.

## Local development

```bash
cp .env.example .env
pnpm install
pnpm dev:db                 # start Postgres in Docker
pnpm prisma:migrate         # apply migrations
pnpm dev:api                # http://localhost:4000
pnpm dev:web                # http://localhost:3000
pnpm dev:mobile             # Expo dev server
```

## Production

Single DigitalOcean Droplet running Docker Compose, Caddy fronting the API and web at `plantr.kauseway.com`. Photos live on disk under `storage/`. Production compose file and Caddyfile are added in a later phase.
