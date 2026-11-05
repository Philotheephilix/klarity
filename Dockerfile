# Klarity — Dockerfile
#
# Two-stage build. The builder stage carries the native toolchain (better-sqlite3
# compiles a C++ addon via node-gyp) and the TypeScript compiler; the runtime
# stage ships only node_modules + the compiled dist. node:22-slim is Debian-based,
# so the builder adds python3 / make / g++ for node-gyp.

# ---- builder ---------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app

# node-gyp toolchain for better-sqlite3's native addon.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install deps against the lockfile first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci

# Compile. tsc emits to dist/. No non-.ts assets are read at runtime — the SQLite
# DDL is inlined in src/db.ts precisely so the compiled dist is self-contained.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop devDependencies from the installed tree for the runtime copy.
RUN npm prune --omit=dev

# ---- runtime ---------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Pruned production node_modules (incl. the prebuilt better-sqlite3 addon) and
# the compiled output. No source, no toolchain in the final image.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# `npm start` runs `node dist/server.js` (the HTTP API). The one-shot backfill
# is `npm run import` with REGISTRY_ROOT set — run it as an override:
#   docker run --rm -e REGISTRY_ROOT=/registry -v $PWD/registry:/registry \
#     klarity npm run import
CMD ["npm", "start"]
