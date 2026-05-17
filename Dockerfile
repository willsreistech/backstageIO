# ─────────────────────────────────────────────────────────────────────────────
# Multi-stage Dockerfile – Backstage (self-contained build)
#
# Build & run with a single command:
#   docker build -t backstage .
#   docker run -d --name backstage \
#     -p 7007:7007 \
#     -e APP_BASE_URL=http://<YOUR_SERVER_IP>:7007 \
#     -e GITHUB_TOKEN=<token> \
#     -e GITHUB_OWNER=<owner> \
#     -e GITHUB_REPO=<repo> \
#     -e GITHUB_BRANCH=main \
#     -e POSTGRES_HOST=<host> \
#     -e POSTGRES_PORT=5432 \
#     -e POSTGRES_USER=<user> \
#     -e POSTGRES_PASSWORD=<password> \
#     -v backstage-uploads:/home/node/data/uploads \
#     backstage
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build

ENV PYTHON=/usr/bin/python3

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 g++ build-essential libsqlite3-dev && \
    rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /app

# Copy Yarn plumbing first for better layer caching
COPY --chown=node:node .yarn ./.yarn
COPY --chown=node:node .yarnrc.yml backstage.json yarn.lock package.json ./
COPY --chown=node:node packages/ ./packages/
COPY --chown=node:node plugins/  ./plugins/
COPY --chown=node:node tsconfig.json ./

RUN yarn install --immutable

RUN yarn tsc

RUN yarn build:backend

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:22-bookworm-slim

ENV PYTHON=/usr/bin/python3

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 g++ build-essential libsqlite3-dev && \
    rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /app

# Copy Yarn plumbing
COPY --chown=node:node .yarn ./.yarn
COPY --chown=node:node .yarnrc.yml backstage.json ./

ENV NODE_ENV=production
ENV NODE_OPTIONS="--no-node-snapshot"

# Install production deps via the skeleton (avoids re-downloading on every build)
COPY --chown=node:node yarn.lock package.json ./
COPY --from=build --chown=node:node /app/packages/backend/dist/skeleton.tar.gz ./
RUN tar xzf skeleton.tar.gz && rm skeleton.tar.gz

RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    yarn workspaces focus --all --production && rm -rf "$(yarn cache clean)"

# Copy examples (used by catalog locations in config)
COPY --chown=node:node examples ./examples

# Copy the backend bundle and all app-config files
COPY --from=build --chown=node:node /app/packages/backend/dist/bundle.tar.gz ./
COPY --chown=node:node app-config.yaml app-config.production.yaml ./
RUN tar xzf bundle.tar.gz && rm bundle.tar.gz

# ── Runtime environment variable defaults ─────────────────────────────────────
# Override APP_BASE_URL with your server's public URL (e.g. http://192.168.1.10:7007)
ENV APP_BASE_URL=http://localhost:7007

# GitHub integration
ENV GITHUB_TOKEN=""
ENV GITHUB_OWNER=""
ENV GITHUB_REPO=""
ENV GITHUB_BRANCH=main

# PostgreSQL (production database)
ENV POSTGRES_HOST=localhost
ENV POSTGRES_PORT=5432
ENV POSTGRES_USER=backstage
ENV POSTGRES_PASSWORD=""

# ── Persistent storage for user uploads ───────────────────────────────────────
# The file-upload plugin writes to ~/data/uploads  →  /home/node/data/uploads
VOLUME ["/home/node/data/uploads"]

EXPOSE 7007

CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml"]
