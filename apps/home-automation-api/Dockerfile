# Build from repository root:
# docker build -f apps/home-automation-api/Dockerfile -t home-automation-api .

FROM node:22-alpine AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.15.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/home-automation-api/package.json apps/home-automation-api/

RUN pnpm install --frozen-lockfile --filter home-automation-api...

COPY apps/home-automation-api apps/home-automation-api

RUN pnpm --filter home-automation-api build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN corepack enable && corepack prepare pnpm@8.15.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/home-automation-api/package.json apps/home-automation-api/

RUN pnpm install --frozen-lockfile --prod --filter home-automation-api...

COPY --from=build /app/apps/home-automation-api/dist apps/home-automation-api/dist

EXPOSE 3000

CMD ["node", "apps/home-automation-api/dist/src/server.js"]
