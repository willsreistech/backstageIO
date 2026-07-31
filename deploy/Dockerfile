# Imagem do backend Backstage para deploy via pipeline.
#
# CONTEXTO de build = `backstage-app/` (a raiz do workspace Yarn).
# Este Dockerfile é do tipo "host-build": ANTES de buildar a imagem, a pipeline
# roda no runner (dentro de backstage-app/):
#     yarn install --immutable && yarn tsc && yarn build:backend
# o que gera packages/backend/dist/{skeleton,bundle}.tar.gz que copiamos abaixo.
#
# Diferença para o Dockerfile padrão: aqui instalamos o MkDocs (TechDocs) DENTRO
# da imagem, porque app-config usa `techdocs.generator.runIn: local` — ou seja,
# o backend executa o binário `mkdocs` de dentro deste container.

FROM node:22-bookworm-slim

# Python é usado pelo node-gyp (isolate-vm / scaffolder) e pelo MkDocs.
ENV PYTHON=/usr/bin/python3

# Dependências de build nativas (isolate-vm) + sqlite.
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ build-essential libsqlite3-dev && \
    rm -rf /var/lib/apt/lists/*

# ── TechDocs: gerador MkDocs dentro da imagem ────────────────────────────────
# --break-system-packages é exigido pelo Debian bookworm (PEP 668).
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3-pip && \
    pip3 install --no-cache-dir --break-system-packages mkdocs-techdocs-core && \
    rm -rf /var/lib/apt/lists/*

# Yarn 4 é provisionado pelo Corepack (campo "packageManager": yarn@4.4.1 no
# package.json). Sem prompt de download durante o build.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# A partir daqui rodamos como o usuário menos privilegiado `node`.
USER node
WORKDIR /app

# Config do Yarn (backstage.json é lido pelo backend).
COPY --chown=node:node .yarnrc.yml backstage.json ./
# Remove `yarnPath`: aponta p/ .yarn/releases/yarn-4.4.1.cjs que NÃO está
# versionado neste repo. Sem ele, o Corepack baixa o yarn 4.4.1 (packageManager).
RUN sed -i '/yarnPath/d' .yarnrc.yml

ENV NODE_ENV=production
# Desabilita snapshot p/ o Scaffolder funcionar.
ENV NODE_OPTIONS="--no-node-snapshot"

# Skeleton primeiro (só os package.json de cada workspace) p/ aproveitar cache.
COPY --chown=node:node yarn.lock package.json packages/backend/dist/skeleton.tar.gz ./
RUN tar xzf skeleton.tar.gz && rm skeleton.tar.gz

# Instala apenas dependências de produção.
RUN yarn workspaces focus --all --production && rm -rf "$(yarn cache clean)"

# Dados de exemplo do catálogo (referenciados por ./examples nas configs).
COPY --chown=node:node examples ./examples

# Bundle do backend + arquivos app-config*.yaml.
COPY --chown=node:node packages/backend/dist/bundle.tar.gz app-config*.yaml ./
RUN tar xzf bundle.tar.gz && rm bundle.tar.gz

# CMD padrão. No deploy o docker-compose SOBRESCREVE o command para incluir
# também `--config app-config.deploy.yaml` (que readiciona o catálogo do k9).
CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml"]
