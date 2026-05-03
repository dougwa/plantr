# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN pnpm install --frozen-lockfile --filter @plantr/web...

FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY apps/web apps/web
RUN pnpm --filter @plantr/web build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo/apps/web
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/apps/web/node_modules /repo/apps/web/node_modules
COPY --from=build /repo/apps/web/.next /repo/apps/web/.next
COPY --from=build /repo/apps/web/next.config.mjs /repo/apps/web/next.config.mjs
COPY --from=build /repo/apps/web/package.json /repo/apps/web/package.json
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
