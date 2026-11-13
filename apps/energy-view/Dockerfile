# Build from the repository root:
# docker build -f apps/energy-view/Dockerfile -t home-automation:1.0.0 .

FROM node:22-alpine AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.15.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/home-automation-api/package.json apps/home-automation-api/
COPY apps/energy-view/package.json apps/energy-view/

RUN pnpm install --frozen-lockfile --filter energy-view...

COPY apps/energy-view apps/energy-view

ARG PUBLIC_ENERGY_API_BASE=https://energy-api.janhalama.cz
ARG PUBLIC_ENERGY_PUBLIC_HOST=energy.janhalama.cz
ENV PUBLIC_ENERGY_API_BASE=$PUBLIC_ENERGY_API_BASE
ENV PUBLIC_ENERGY_PUBLIC_HOST=$PUBLIC_ENERGY_PUBLIC_HOST

RUN pnpm --filter energy-view build

FROM nginx:1.27-alpine

COPY apps/energy-view/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/energy-view/dist /usr/share/nginx/html

EXPOSE 80
