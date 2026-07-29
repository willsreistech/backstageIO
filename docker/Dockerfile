# Etapa 1 — Builder
FROM node:22-slim AS builder

WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock ./
COPY . .

RUN yarn install --frozen-lockfile
RUN yarn tsc
RUN yarn build

# Etapa 2 — Runtime (distroless)
FROM gcr.io/distroless/nodejs22

WORKDIR /app

COPY --from=builder /app ./

ENV NODE_ENV=production

CMD ["packages/backend/dist/index.js"]
