# Imagem do backend Backstage para deploy via pipeline (MULTI-STAGE).
#
# CONTEXTO de build = `backstage-app/` (raiz do workspace Yarn).
#
# Este Dockerfile é SELF-CONTAINED: o build do Backstage acontece DENTRO do
# Docker (stage `build`), então o runner só precisa de `docker` — não precisa
# de Node/Yarn no host. A imagem final embute o gerador MkDocs (TechDocs),
# porque app-config usa `techdocs.generator.runIn: local` (o backend executa o
# binário `mkdocs` de dentro deste container).

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-bookworm AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

USER node
WORKDIR /app

# Copia todo o workspace (contexto = backstage-app/).
COPY --chown=node:node . .

# Remove `yarnPath` (aponta p/ .yarn/releases/yarn-4.4.1.cjs, NÃO versionado);
# o Corepack provisiona o yarn 4.4.1 a partir de "packageManager" no package.json.
RUN sed -i '/yarnPath/d' .yarnrc.yml

# Instala deps, gera tipos e empacota o backend:
# produz packages/backend/dist/{skeleton,bundle}.tar.gz
RUN yarn install --immutable
RUN yarn tsc
RUN yarn build:backend

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim

# Python é usado pelo node-gyp (isolate-vm / scaffolder) e pelo MkDocs.
ENV PYTHON=/usr/bin/python3

# Deps nativas (isolate-vm) + sqlite + MkDocs (TechDocs).
# --break-system-packages exigido pelo Debian bookworm (PEP 668).
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 python3-pip g++ build-essential libsqlite3-dev && \
    pip3 install --no-cache-dir --break-system-packages mkdocs-techdocs-core && \
    rm -rf /var/lib/apt/lists/*

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# A partir daqui rodamos como o usuário menos privilegiado `node`.
USER node
WORKDIR /app

ENV NODE_ENV=production
# Desabilita snapshot p/ o Scaffolder funcionar.
ENV NODE_OPTIONS="--no-node-snapshot"

# Config do Yarn + skeleton (só os package.json de cada workspace) p/ cache.
COPY --from=build --chown=node:node \
     /app/.yarnrc.yml /app/backstage.json /app/package.json /app/yarn.lock ./
RUN sed -i '/yarnPath/d' .yarnrc.yml
COPY --from=build --chown=node:node /app/packages/backend/dist/skeleton.tar.gz ./
RUN tar xzf skeleton.tar.gz && rm skeleton.tar.gz

# Instala apenas dependências de produção.
RUN yarn workspaces focus --all --production && rm -rf "$(yarn cache clean)"

# Dados de exemplo do catálogo (referenciados por ./examples nas configs).
COPY --from=build --chown=node:node /app/examples ./examples

# Bundle do backend + arquivos app-config*.yaml.
COPY --from=build --chown=node:node \
     /app/packages/backend/dist/bundle.tar.gz \
     /app/app-config.yaml /app/app-config.production.yaml ./
RUN tar xzf bundle.tar.gz && rm bundle.tar.gz

# CMD padrão. No deploy o docker-compose SOBRESCREVE o command para incluir
# também `--config app-config.deploy.yaml` (que readiciona o catálogo do k9).
CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml"]
