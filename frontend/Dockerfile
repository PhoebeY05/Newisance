# Build the SPA, then bake it into a tiny Caddy image that also reverse-proxies
# the /api/* paths to the backend services. Build context is the repo root.
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM caddy:2-alpine
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
