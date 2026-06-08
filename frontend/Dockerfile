# Build the SPA, then bake it into a tiny Caddy image that also reverse-proxies
# the /api/* paths to the backend services. Build context is the repo root.
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Optional Google login. Vite bakes VITE_* vars in at build time, so it must be
# present as an env var before `npm run build` (passed as a build arg from compose).
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build

FROM caddy:2-alpine
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
