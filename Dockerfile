# syntax=docker/dockerfile:1

# ---------- build: install, generate the Prisma client, compile TS ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json prisma7.config.ts ./
COPY prisma ./prisma
COPY src ./src
# `generate` never opens a connection, but prisma7.config.ts refuses to load
# without DATABASE_URL. Scoped to this command so it never becomes a layer.
# src/generated/ is gitignored, so without this `tsc` has no client to compile.
RUN DATABASE_URL=postgresql://generate npx prisma generate && npm run build

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# prisma is a devDependency, but Render's pre-deploy command runs
# `prisma migrate deploy`. Adding back just the CLI beats shipping all devDeps.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && \
    npm install --no-save prisma@^7.10.0 && \
    npm cache clean --force

COPY --from=build /app/dist ./dist
# Only the pre-deploy migration reads these two; the app needs just dist/.
COPY prisma ./prisma
COPY prisma7.config.ts ./

# Nothing is written to disk at runtime, so files stay root-owned and the
# process runs unprivileged.
USER node

EXPOSE 4000

# Exec form: node is PID 1 and receives Render's SIGTERM directly, so the
# handler in src/index.ts can drain the BullMQ worker.
CMD ["node", "dist/index.js"]
