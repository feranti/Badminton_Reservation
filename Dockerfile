# Image de production du site, construite par GitHub Actions (.github/workflows/deploy.yml) à chaque
# push sur main, publiée sur GHCR puis déployée par Dokploy sur le VPS.
# Aucune variable au moment du build : toutes (DATABASE_URL, CRON_SECRET, SMTP, Green API, APP_URL)
# se donnent à l'exécution, dans l'onglet « Environment » de Dokploy.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Le serveur autonome ne sert public/ et .next/static que s'ils sont copiés à côté de lui.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
