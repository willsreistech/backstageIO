# Tutorial — Backstage Binary Upload Plugin

> Projeto Backstage.io com upload de binários para disco local e push automático para GitHub,
> com suporte a Git LFS para arquivos grandes, navegador de diretórios e gerenciamento de arquivos.

---

## Índice

1. [Visão Geral](#1-visão-geral)
2. [Pré-requisitos](#2-pré-requisitos)
3. [Estrutura de Arquivos](#3-estrutura-de-arquivos)
4. [Passo a Passo — Criação do Projeto](#4-passo-a-passo--criação-do-projeto)
5. [Arquivos Criados — Backend Plugin](#5-arquivos-criados--backend-plugin)
6. [Arquivos Criados — Frontend Plugin](#6-arquivos-criados--frontend-plugin)
7. [Arquivos Modificados](#7-arquivos-modificados)
8. [Variáveis de Ambiente](#8-variáveis-de-ambiente)
9. [Configuração do app-config.yaml](#9-configuração-do-app-configyaml)
10. [Como Executar](#10-como-executar)
11. [Permissões do GitHub Token](#11-permissões-do-github-token)
12. [Git LFS — Configuração no Repositório](#12-git-lfs--configuração-no-repositório)
13. [Funcionalidades Implementadas](#13-funcionalidades-implementadas)
14. [Endpoints da API](#14-endpoints-da-api)

---

## 1. Visão Geral

Este projeto é um plugin customizado para **Backstage v1.50.0** que permite:

- **Upload de binários** via interface drag-and-drop
- **Salvar o arquivo** em disco no servidor (`~/data/uploads/`)
- **Push automático** para um repositório GitHub via API
- **Git LFS automático** para arquivos > 100 MB ou extensões configuradas (`.ear`, `.exe`, `.war`, etc.)
- **Navegador de diretórios** com breadcrumb para explorar o repositório
- **Listagem e deleção** de arquivos diretamente do GitHub
- **Seletor de repositório** mostrando apenas repos com permissão de escrita

---

## 2. Pré-requisitos

| Ferramenta | Versão |
|---|---|
| Node.js | **22** (obrigatório — `isolated-vm` só tem binários para Node 22+) |
| NVM | Qualquer versão recente |
| Yarn | 4.4.1 (Yarn Berry via Corepack) |
| Git | Qualquer versão recente |

### Instalar NVM e Node 22

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm alias default 22
nvm use 22
```

### Habilitar Corepack (Yarn Berry)

```bash
corepack enable
```

---

## 3. Estrutura de Arquivos

```
serverstage/
├── app-config.yaml                          # ← MODIFICADO: config do plugin
├── .env                                     # ← CRIADO: variáveis de ambiente
├── .env.example                             # ← CRIADO: template do .env
├── .nvmrc                                   # ← CRIADO: força Node 22
├── tutorial.md                              # ← CRIADO: este arquivo
│
├── packages/
│   ├── app/
│   │   ├── package.json                     # ← MODIFICADO: link para o plugin frontend
│   │   └── src/
│   │       └── App.tsx                      # ← MODIFICADO: registra fileUploadPlugin
│   └── backend/
│       ├── package.json                     # ← MODIFICADO: link para o plugin backend
│       └── src/
│           └── index.ts                     # ← MODIFICADO: registra fileUploadPlugin
│
└── plugins/
    ├── file-upload/                         # Plugin frontend (CRIADO DO ZERO)
    │   ├── package.json
    │   └── src/
    │       ├── index.ts
    │       ├── plugin.tsx
    │       └── components/
    │           └── FileUploadPage.tsx
    │
    └── file-upload-backend/                 # Plugin backend (CRIADO DO ZERO)
        ├── package.json
        └── src/
            ├── index.ts
            ├── plugin.ts
            └── router.ts
```

---

## 4. Passo a Passo — Criação do Projeto

### 4.1 Scaffold do Backstage

```bash
npx @backstage/create-app@latest --skip-install
# Nome: serverstage
# Mover para o diretório:
cd serverstage
```

### 4.2 Criar estrutura dos plugins

```bash
# Backend plugin
mkdir -p plugins/file-upload-backend/src

# Frontend plugin
mkdir -p plugins/file-upload/src/components
```

### 4.3 Instalar dependências

```bash
# No diretório raiz do projeto
yarn install
```

### 4.4 Criar o arquivo .env

```bash
cat > .env << 'EOF'
GITHUB_TOKEN=github_pat_SEU_TOKEN_AQUI
GITHUB_OWNER=seu_usuario_github
GITHUB_REPO=nome_do_repo
GITHUB_BRANCH=main
EOF
```

### 4.5 Exportar variáveis e iniciar

```bash
export $(grep -v '^#' .env | xargs)
yarn start
```

---

## 5. Arquivos Criados — Backend Plugin

### `plugins/file-upload-backend/package.json`

**O que faz:** Define o pacote do plugin backend, suas dependências e scripts.

```json
{
  "name": "@internal/plugin-file-upload-backend",
  "version": "0.1.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "private": true,
  "backstage": {
    "role": "backend-plugin"
  },
  "scripts": {
    "start": "backstage-cli package start",
    "build": "backstage-cli package build",
    "lint": "backstage-cli package lint",
    "test": "backstage-cli package test",
    "clean": "backstage-cli package clean"
  },
  "dependencies": {
    "@backstage/backend-plugin-api": "^1.9.0",
    "@backstage/config": "^1.3.7",
    "@octokit/rest": "^20.1.1",
    "express": "^4.21.2",
    "multer": "^1.4.5-lts.1"
  },
  "devDependencies": {
    "@backstage/cli": "^0.36.1",
    "@types/express": "^4.17.21",
    "@types/multer": "^1.4.12",
    "jest": "*"
  }
}
```

---

### `plugins/file-upload-backend/src/index.ts`

**O que faz:** Ponto de entrada do plugin backend — re-exporta o plugin e o router.

```typescript
export { fileUploadPlugin } from './plugin';
export { createRouter } from './router';
```

---

### `plugins/file-upload-backend/src/plugin.ts`

**O que faz:** Registra o plugin no sistema de backend do Backstage, injeta as dependências (config, logger, httpRouter) e define as políticas de autenticação para cada rota (todas `unauthenticated` para facilitar o uso interno).

```typescript
import {
  createBackendPlugin,
  coreServices,
} from '@backstage/backend-plugin-api';
import { createRouter } from './router';

export const fileUploadPlugin = createBackendPlugin({
  pluginId: 'file-upload',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ httpRouter, config, logger }) {
        const router = await createRouter({ config, logger });
        httpRouter.use(router);
        httpRouter.addAuthPolicy({ path: '/repos',  allow: 'unauthenticated' });
        httpRouter.addAuthPolicy({ path: '/upload', allow: 'unauthenticated' });
        httpRouter.addAuthPolicy({ path: '/list',   allow: 'unauthenticated' });
        httpRouter.addAuthPolicy({ path: '/delete', allow: 'unauthenticated' });
        httpRouter.addAuthPolicy({ path: '/health', allow: 'unauthenticated' });
      },
    });
  },
});
```

---

### `plugins/file-upload-backend/src/router.ts`

**O que faz:** Núcleo do plugin. Define todas as rotas REST:
- Salva arquivos em disco com Multer
- Usa a GitHub Contents API para arquivos ≤ 100 MB
- Usa Git LFS para arquivos > 100 MB ou extensões configuradas
- Lista repositórios com permissão de escrita
- Navega diretórios do repositório
- Deleta arquivos do GitHub e cópia local

```typescript
import { Config } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';
import express, { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import { Octokit } from '@octokit/rest';

// Files larger than this threshold are pushed via Git LFS instead of the Contents API
const LFS_THRESHOLD = 100 * 1024 * 1024; // 100 MB (overridden by config at runtime)

/** Calculates the SHA-256 hash of a file using streams (memory-efficient for large files). */
function sha256ofFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash   = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.on('end',  () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** Streams a local file to an HTTPS/HTTP endpoint via PUT (used for LFS object upload). */
function lfsHttpPut(url: string, headers: Record<string, string>, filePath: string, fileSize: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const req    = lib.request(
      {
        hostname: parsed.hostname,
        port:     parsed.port || undefined,
        path:     parsed.pathname + parsed.search,
        method:   'PUT',
        headers:  { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(fileSize) },
      },
      res => {
        res.resume();
        const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300;
        ok ? resolve() : reject(new Error(`LFS PUT failed: HTTP ${res.statusCode}`));
      },
    );
    req.on('error', reject);
    fs.createReadStream(filePath).pipe(req);
  });
}

export interface RouterOptions {
  config: Config;
  logger: LoggerService;
}

// ── GitHub config helper ──────────────────────────────────────────────────────
function getGitHubConfig(config: Config) {
  let token: string;
  try {
    token = config.getString('fileUpload.github.token');
  } catch {
    token = config.getConfigArray('integrations.github')[0].getString('token');
  }
  const owner     = config.getString('fileUpload.github.owner');
  const repo      = config.getString('fileUpload.github.repo');
  const branch    = config.getOptionalString('fileUpload.github.branch') ?? 'main';
  const targetDir = config.getOptionalString('fileUpload.github.targetDir') ?? 'uploads';
  return { token, owner, repo, branch, targetDir };
}

/** Returns true when the file should be pushed via Git LFS. */
function shouldUseLfs(config: Config, filename: string, fileSize: number): boolean {
  const thresholdMb = config.getOptionalNumber('fileUpload.lfs.sizeThresholdMb') ?? 100;
  const threshold   = thresholdMb * 1024 * 1024;
  if (fileSize > threshold) return true;
  const ext     = path.extname(filename).toLowerCase();
  const lfsExts = config.getOptionalStringArray('fileUpload.lfs.extensions') ?? [];
  return lfsExts.map(e => e.toLowerCase()).includes(ext);
}

export async function createRouter(options: RouterOptions): Promise<Router> {
  const { config, logger } = options;

  // ── Upload directory ───────────────────────────────────────────────────────
  const uploadDir = path.join(os.homedir(), 'data', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  logger.info(`File upload directory: ${uploadDir}`);

  // ── Multer – disk storage ──────────────────────────────────────────────────
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safeName}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5 GB – large files go via LFS
  });

  const router = Router();
  router.use(express.json());

  // ── GET /repos ─────────────────────────────────────────────────────────────
  router.get('/repos', async (_req: Request, res: Response) => {
    try {
      const { token, owner } = getGitHubConfig(config);
      const octokit = new Octokit({ auth: token });

      const allPages = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
        per_page: 100,
        sort: 'updated',
        affiliation: 'owner,collaborator,organization_member',
      });

      // Apenas repos do owner configurado com permissão de escrita
      const repos = allPages
        .filter((r: any) =>
          r.owner?.login?.toLowerCase() === owner.toLowerCase() &&
          (r.permissions?.push === true || r.permissions?.admin === true),
        )
        .map((r: any) => ({
          name:        r.name,
          fullName:    r.full_name,
          description: r.description ?? '',
          private:     r.private,
        }));

      res.json({ repos, owner });
    } catch (err: any) {
      logger.error(`List repos failed: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /upload ───────────────────────────────────────────────────────────
  router.post('/upload', upload.single('file') as unknown as express.RequestHandler, async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided. Use form-field "file".' });
      return;
    }

    const savedPath = req.file.path;
    logger.info(`Binary saved to disk: ${savedPath}`);

    try {
      const cfg        = getGitHubConfig(config);
      const repo       = (req.body?.repo as string) || cfg.repo;
      const { token, owner, branch } = cfg;
      const octokit    = new Octokit({ auth: token });

      const uploadPath = (req.body?.uploadPath as string) ?? '';
      const safeName   = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const remotePath = uploadPath ? `${uploadPath}/${safeName}` : safeName;
      const fileSize   = req.file.size;

      const getExistingSha = async (): Promise<string | undefined> => {
        try {
          const { data } = await octokit.repos.getContent({ owner, repo, path: remotePath, ref: branch });
          return (!Array.isArray(data) && data.sha) ? data.sha : undefined;
        } catch { return undefined; }
      };

      if (shouldUseLfs(config, safeName, fileSize)) {
        // ── Git LFS path ────────────────────────────────────────────────────
        logger.info(`File qualifies for Git LFS (size: ${(fileSize / 1024 / 1024).toFixed(1)} MB, ext: ${path.extname(safeName)})`);
        const oid = await sha256ofFile(savedPath);

        // 1. Batch request
        const batchRes = await fetch(
          `https://github.com/${owner}/${repo}.git/info/lfs/objects/batch`,
          {
            method: 'POST',
            headers: {
              'Content-Type':  'application/vnd.git-lfs+json',
              'Accept':        'application/vnd.git-lfs+json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              operation: 'upload',
              transfers: ['basic'],
              refs:      { name: `refs/heads/${branch}` },
              objects:   [{ oid, size: fileSize }],
            }),
          },
        );
        if (!batchRes.ok) throw new Error(`LFS batch failed: HTTP ${batchRes.status}`);

        const batchData = await batchRes.json() as any;
        const lfsObj    = batchData.objects?.[0];
        if (!lfsObj)      throw new Error('LFS batch response contained no objects');
        if (lfsObj.error) throw new Error(`LFS error: ${lfsObj.error.message}`);

        // 2. Upload objeto LFS (se ainda não existir)
        if (lfsObj.actions?.upload) {
          const { href, header } = lfsObj.actions.upload as { href: string; header: Record<string, string> };
          logger.info(`Uploading ${(fileSize / 1024 / 1024).toFixed(1)} MB to LFS storage…`);
          await lfsHttpPut(href, header ?? {}, savedPath, fileSize);
          logger.info('LFS object upload complete');
        }

        // 3. Verify (opcional)
        if (lfsObj.actions?.verify) {
          const { href, header } = lfsObj.actions.verify as { href: string; header: Record<string, string> };
          await fetch(href, {
            method: 'POST',
            headers: { ...header, 'Content-Type': 'application/vnd.git-lfs+json' },
            body: JSON.stringify({ oid, size: fileSize }),
          });
        }

        // 4. Commita o LFS pointer no repositório
        const pointer     = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${fileSize}\n`;
        const existingSha = await getExistingSha();
        await octokit.repos.createOrUpdateFileContents({
          owner, repo, branch,
          path:    remotePath,
          message: `chore: upload LFS binary ${safeName}`,
          content: Buffer.from(pointer).toString('base64'),
          ...(existingSha ? { sha: existingSha } : {}),
        });

        logger.info(`LFS pointer committed: ${owner}/${repo}/${remotePath}`);
        res.status(200).json({
          message:   'File uploaded via Git LFS and committed to GitHub.',
          lfs:       true,
          localPath: savedPath,
          github:    { owner, repo, branch, path: remotePath, url: `https://github.com/${owner}/${repo}/blob/${branch}/${remotePath}` },
        });

      } else {
        // ── Regular Contents API (≤ 100 MB) ─────────────────────────────────
        const base64Content = fs.readFileSync(savedPath).toString('base64');
        const existingSha   = await getExistingSha();

        await octokit.repos.createOrUpdateFileContents({
          owner, repo, branch,
          path:    remotePath,
          message: `chore: upload binary ${safeName}`,
          content: base64Content,
          ...(existingSha ? { sha: existingSha } : {}),
        });

        logger.info(`File pushed to GitHub: ${owner}/${repo}/${remotePath}`);
        res.status(200).json({
          message:   'File uploaded and pushed to GitHub.',
          lfs:       false,
          localPath: savedPath,
          github:    { owner, repo, branch, path: remotePath, url: `https://github.com/${owner}/${repo}/blob/${branch}/${remotePath}` },
        });
      }
    } catch (err: any) {
      logger.error(`GitHub push failed: ${err.message}`);
      res.status(207).json({
        message:   'File saved locally but GitHub push failed.',
        localPath: savedPath,
        error:     err.message,
      });
    }
  });

  // ── GET /list ──────────────────────────────────────────────────────────────
  router.get('/list', async (req: Request, res: Response) => {
    try {
      const cfg     = getGitHubConfig(config);
      const repo    = (req.query.repo as string) || cfg.repo;
      const dirPath = (req.query.path as string) ?? '';
      const { token, owner, branch } = cfg;
      const octokit = new Octokit({ auth: token });

      let items: object[] = [];
      try {
        const response = await octokit.repos.getContent({ owner, repo, path: dirPath, ref: branch });
        if (Array.isArray(response.data)) {
          items = response.data
            .filter((item: any) => item.type === 'file' || item.type === 'dir')
            .map((item: any) => ({
              type:        item.type,
              name:        item.name,
              path:        item.path,
              sha:         item.sha,
              size:        item.size ?? 0,
              url:         item.html_url,
              downloadUrl: item.download_url ?? null,
            }));
          items.sort((a: any, b: any) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        }
      } catch (err: any) {
        if (err.status !== 404) throw err;
      }

      res.json({ items });
    } catch (err: any) {
      logger.error(`List failed: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /delete ─────────────────────────────────────────────────────────
  router.delete('/delete', async (req: Request, res: Response) => {
    const filePath = req.query.path as string | undefined;
    if (!filePath) {
      res.status(400).json({ error: 'Missing required query param: path' });
      return;
    }
    try {
      const cfg    = getGitHubConfig(config);
      const repo   = (req.query.repo as string) || cfg.repo;
      const { token, owner, branch } = cfg;
      const octokit = new Octokit({ auth: token });

      const existing = await octokit.repos.getContent({ owner, repo, path: filePath, ref: branch });
      if (Array.isArray(existing.data) || !existing.data.sha) {
        res.status(400).json({ error: 'Target is a directory, not a file.' });
        return;
      }

      await octokit.repos.deleteFile({
        owner, repo, branch,
        path:    filePath,
        message: `chore: remove ${filePath}`,
        sha:     existing.data.sha,
      });
      logger.info(`File deleted from GitHub: ${owner}/${repo}/${filePath}`);

      const filename = filePath.split('/').pop() ?? filePath;
      try {
        for (const f of fs.readdirSync(uploadDir).filter(f => f === filename || f.endsWith(`-${filename}`))) {
          fs.unlinkSync(path.join(uploadDir, f));
          logger.info(`Local file removed: ${f}`);
        }
      } catch { /* non-critical */ }

      res.json({ message: `File "${filePath}" deleted from GitHub.` });
    } catch (err: any) {
      logger.error(`Delete file failed: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /health ────────────────────────────────────────────────────────────
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', uploadDir });
  });

  return router;
}
```

---

## 6. Arquivos Criados — Frontend Plugin

### `plugins/file-upload/package.json`

**O que faz:** Define o pacote do plugin frontend e suas dependências.

```json
{
  "name": "@internal/plugin-file-upload",
  "version": "0.1.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "private": true,
  "backstage": {
    "role": "frontend-plugin"
  },
  "dependencies": {
    "@backstage/core-components": "*",
    "@backstage/core-plugin-api": "*",
    "@backstage/frontend-plugin-api": "*",
    "@material-ui/core": "^4.12.4",
    "@material-ui/icons": "^4.11.3",
    "react": "^18.0.2"
  }
}
```

---

### `plugins/file-upload/src/index.ts`

**O que faz:** Ponto de entrada do plugin frontend.

```typescript
export { fileUploadPlugin } from './plugin';
```

---

### `plugins/file-upload/src/plugin.tsx`

**O que faz:** Define o plugin frontend com:
- `PageBlueprint` — registra a rota `/file-upload`
- `NavItemBlueprint` — cria o item no menu lateral do Backstage
- `createRouteRef` — referência de rota necessária para o NavItem funcionar

```tsx
import {
  createFrontendPlugin,
  createRouteRef,
  PageBlueprint,
  NavItemBlueprint,
} from '@backstage/frontend-plugin-api';
import CloudUploadIcon from '@material-ui/icons/CloudUpload';

const rootRouteRef = createRouteRef();

const fileUploadPage = PageBlueprint.make({
  params: {
    path:     '/file-upload',
    routeRef: rootRouteRef,
    title:    'File Upload',
    icon:     <CloudUploadIcon fontSize="inherit" />,
    loader: async () => {
      const { FileUploadPage } = await import('./components/FileUploadPage');
      return <FileUploadPage />;
    },
  },
});

const fileUploadNavItem = NavItemBlueprint.make({
  params: {
    routeRef: rootRouteRef,
    title:    'File Upload',
    icon:     CloudUploadIcon,
  },
});

export const fileUploadPlugin = createFrontendPlugin({
  pluginId:   'file-upload',
  routes:     { root: rootRouteRef },
  extensions: [fileUploadPage, fileUploadNavItem],
});

export default fileUploadPlugin;
```

---

### `plugins/file-upload/src/components/FileUploadPage.tsx`

**O que faz:** Componente React principal com toda a UI:

- **Passo 1** — Seletor de repositório (dropdown com repos que o token tem escrita)
- **Passo 2** — Navegador de diretórios com breadcrumb e botão de deletar por arquivo
- **Passo 3** — Upload drag-and-drop com indicação automática de LFS

```tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Button, CircularProgress, LinearProgress, Typography, Paper, Chip,
  Table, TableHead, TableBody, TableRow, TableCell,
  IconButton, Tooltip, Divider, FormControl, InputLabel, Select, MenuItem,
  Breadcrumbs, Link,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import CloudUploadIcon    from '@material-ui/icons/CloudUpload';
import CheckCircleIcon    from '@material-ui/icons/CheckCircle';
import ErrorIcon          from '@material-ui/icons/Error';
import DeleteIcon         from '@material-ui/icons/Delete';
import RefreshIcon        from '@material-ui/icons/Refresh';
import FolderIcon         from '@material-ui/icons/Folder';
import InsertDriveFileIcon from '@material-ui/icons/InsertDriveFile';
import StorageIcon        from '@material-ui/icons/Storage';
import { Page, Header, Content } from '@backstage/core-components';
import { configApiRef, useApi } from '@backstage/core-plugin-api';

// [... estilos, interfaces e lógica do componente — ver arquivo completo em]
// plugins/file-upload/src/components/FileUploadPage.tsx
```

> **Nota:** O arquivo completo tem ~560 linhas. Está em `plugins/file-upload/src/components/FileUploadPage.tsx`.

---

## 7. Arquivos Modificados

### `packages/backend/package.json`

**O que foi adicionado:** Dependência para o plugin backend customizado.

```json
{
  "dependencies": {
    "@internal/plugin-file-upload-backend": "link:../../plugins/file-upload-backend"
  }
}
```

---

### `packages/backend/src/index.ts`

**O que foi adicionado:** Import e registro do `fileUploadPlugin`.

```typescript
// Linha adicionada no topo:
import { fileUploadPlugin } from '@internal/plugin-file-upload-backend';

// Linha adicionada antes de backend.start():
backend.add(fileUploadPlugin);
```

**O que foi removido:** `@backstage/plugin-mcp-actions-backend` (usa `isolated-vm` que requer compilação nativa com `make`, indisponível no ambiente).

---

### `packages/app/package.json`

**O que foi adicionado:** Dependência para o plugin frontend customizado.

```json
{
  "dependencies": {
    "@internal/plugin-file-upload": "link:../../plugins/file-upload"
  }
}
```

---

### `packages/app/src/App.tsx`

**O que foi adicionado:** Import e registro do plugin frontend.

```typescript
// Antes:
import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import { navModule } from './modules/nav';

export default createApp({
  features: [catalogPlugin, navModule],
});

// Depois:
import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import { navModule } from './modules/nav';
import { fileUploadPlugin } from '@internal/plugin-file-upload'; // ← ADICIONADO

export default createApp({
  features: [catalogPlugin, navModule, fileUploadPlugin], // ← ADICIONADO
});
```

---

### `app-config.yaml`

**O que foi adicionado:** Seção de configuração do plugin de upload.

```yaml
# ── File Upload Plugin ────────────────────────────────────────────────────────
fileUpload:
  github:
    token: ${GITHUB_TOKEN}    # Token GitHub (Fine-grained ou Classic PAT)
    owner: ${GITHUB_OWNER}    # Usuário ou organização GitHub
    repo:  ${GITHUB_REPO}     # Nome do repositório padrão
    branch: ${GITHUB_BRANCH}  # Branch alvo (padrão: main)
    targetDir: uploads         # Subdiretório padrão dentro do repo
  lfs:
    # Arquivos maiores que este valor (MB) vão automaticamente via Git LFS
    sizeThresholdMb: 100
    # Estas extensões SEMPRE usam Git LFS, independente do tamanho
    extensions:
      - .ear
      - .exe
      - .war
      - .jar
      - .zip
```

---

## 8. Variáveis de Ambiente

### `.env` (criado na raiz do projeto)

```bash
GITHUB_TOKEN=github_pat_SEU_TOKEN_AQUI
GITHUB_OWNER=seu_usuario_github
GITHUB_REPO=nome_do_repositorio_padrao
GITHUB_BRANCH=main
```

### `.env.example` (template para outros devs)

```bash
GITHUB_TOKEN=          # Fine-grained PAT ou Classic PAT
GITHUB_OWNER=          # Usuário ou organização
GITHUB_REPO=           # Repositório padrão
GITHUB_BRANCH=main     # Branch (padrão: main)
```

### `.nvmrc`

```
22
```

---

## 9. Configuração do app-config.yaml

A configuração completa relevante para o plugin está descrita na seção [7 — Arquivos Modificados](#arquivos-modificados). Para referência rápida:

| Chave | Tipo | Descrição |
|---|---|---|
| `fileUpload.github.token` | string | Token GitHub para autenticação na API |
| `fileUpload.github.owner` | string | Dono dos repositórios (user/org) |
| `fileUpload.github.repo` | string | Repo padrão (fallback quando nenhum selecionado) |
| `fileUpload.github.branch` | string | Branch alvo para commits |
| `fileUpload.github.targetDir` | string | Pasta padrão dentro do repo (legado) |
| `fileUpload.lfs.sizeThresholdMb` | number | Tamanho em MB que ativa LFS (padrão: 100) |
| `fileUpload.lfs.extensions` | string[] | Extensões que sempre usam LFS |

---

## 10. Como Executar

```bash
# 1. Garantir Node 22
nvm use 22

# 2. Entrar no diretório do projeto
cd serverstage

# 3. Instalar dependências (apenas na primeira vez)
yarn install

# 4. Exportar variáveis de ambiente
export $(grep -v '^#' .env | xargs)

# 5. Iniciar frontend + backend
yarn start
```

A aplicação fica disponível em **http://localhost:3000**

O plugin aparece no menu lateral como **"File Upload"**.

---

## 11. Permissões do GitHub Token

### Permissões mínimas necessárias (Fine-grained PAT)

| Permissão | Nível | Motivo |
|---|---|---|
| **Metadata** | Read | Obrigatória pelo GitHub em todo fine-grained PAT |
| **Contents** (Code) | Read and Write | Listar, navegar, fazer upload, deletar e usar LFS |

### Por que cada operação precisa de Contents R/W

| Operação | Método da API | Permissão |
|---|---|---|
| Listar repositórios disponíveis | `repos.listForAuthenticatedUser` | Metadata (read) |
| Navegar diretórios do repo | `repos.getContent` | Contents (read) |
| Upload ≤ 100 MB | `repos.createOrUpdateFileContents` | Contents (write) |
| Upload > 100 MB (LFS batch) | `POST /info/lfs/objects/batch` | Contents (write) |
| Commit do LFS pointer | `repos.createOrUpdateFileContents` | Contents (write) |
| Deletar arquivo | `repos.deleteFile` | Contents (write) |

### Criar um Fine-grained PAT correto

1. Acesse: **https://github.com/settings/tokens?type=beta**
2. Clique em **"Generate new token"**
3. Em **Repository access** → selecione os repositórios desejados
4. Em **Repository permissions**:
   - **Metadata** → `Read-only`
   - **Contents** → `Read and write`
5. Copie o token e coloque no `.env`

---

## 12. Git LFS — Configuração no Repositório

Para que arquivos LFS sejam corretamente reconhecidos quando alguém clona o repositório, o repo precisa ter o `.gitattributes` configurado:

```bash
# No clone local do repositório alvo:
git lfs install
git lfs track "*.ear"
git lfs track "*.exe"
git lfs track "*.war"
git lfs track "*.jar"
git lfs track "*.zip"
git add .gitattributes
git commit -m "chore: configure Git LFS tracking"
git push
```

> **Nota:** O plugin já faz o upload via LFS corretamente sem o `.gitattributes`. Ele é necessário apenas para que `git clone` baixe automaticamente os arquivos via LFS em vez do pointer.

### Fluxo interno do LFS (para arquivos qualificados)

```
1. Calcular SHA-256 do arquivo (streaming, eficiente em memória)
        ↓
2. POST /info/lfs/objects/batch → GitHub retorna URL de upload
        ↓
3. PUT para o storage LFS do GitHub (streaming via pipe)
        ↓
4. Commit do LFS pointer file no repositório:
   version https://git-lfs.github.com/spec/v1
   oid sha256:<hash>
   size <bytes>
```

---

## 13. Funcionalidades Implementadas

### UI — 3 seções na página

```
┌──────────────────────────────────────────────────────────────┐
│  1. Select Repository          [dropdown]          [Refresh]  │
└──────────────────────────────────────────────────────────────┘

┌─────────────────────────────┐  ┌───────────────────────────┐
│  2. Browse <repo>      [↺]  │  │  3. Upload Binary         │
│  root > pasta > subpasta    │  │  ┌─────────────────────┐  │
│  ─────────────────────────  │  │  │   drag & drop aqui  │  │
│  📁 configs/           —    │  │  └─────────────────────┘  │
│  📁 uploads/           —    │  │                           │
│  📄 README.md    2.1 KB [🗑]│  │  [Upload to /pasta]       │
│  📄 app.war      8.4 MB [🗑]│  │                           │
└─────────────────────────────┘  └───────────────────────────┘
```

### Comportamento do seletor de repositório
- Lista apenas repos do `GITHUB_OWNER` configurado
- Filtra apenas repos onde o token tem `push` ou `admin`
- Mostra 🔒 para repos privados e 📂 para públicos

### Comportamento do navegador de diretórios
- Inicia na raiz (`/`) do repo selecionado
- Diretórios aparecem primeiro (ícone amarelo 📁), clicáveis
- Arquivos têm ícone 📄 com link para o GitHub e botão de deletar
- Breadcrumb clicável para navegar para qualquer nível
- Ao trocar o repo, reseta para a raiz automaticamente
- Botão Refresh atualiza o diretório atual

### Comportamento do upload
- Chip muda de cor (azul → laranja) e mostra `· LFS` quando o arquivo qualifica
- Botão mostra `Upload to /caminho/atual` refletindo o diretório navegado
- Após upload bem-sucedido, a lista de arquivos atualiza automaticamente
- Resultado mostra badge **Git LFS** se o arquivo foi enviado via LFS

### Lógica LFS
| Condição | Resultado |
|---|---|
| Tamanho > `sizeThresholdMb` MB | Usa LFS |
| Extensão na lista `extensions` | Usa LFS |
| Caso contrário | GitHub Contents API |

---

## 14. Endpoints da API

Base URL: `http://localhost:7007/api/file-upload`

| Método | Endpoint | Parâmetros | Descrição |
|---|---|---|---|
| `GET` | `/repos` | — | Lista repos do owner com permissão de escrita |
| `GET` | `/list` | `?repo=X&path=Y` | Lista conteúdo do diretório `Y` no repo `X` |
| `POST` | `/upload` | form: `file`, `repo`, `uploadPath` | Faz upload e push para GitHub (auto LFS) |
| `DELETE` | `/delete` | `?path=X&repo=Y` | Deleta arquivo `X` do repo `Y` e cópia local |
| `GET` | `/health` | — | Verifica status e retorna o diretório de upload |

### Exemplo — Upload via curl

```bash
curl -X POST http://localhost:7007/api/file-upload/upload \
  -F "file=@/caminho/para/arquivo.war" \
  -F "repo=meu-repositorio" \
  -F "uploadPath=releases/v1.0"
```

### Exemplo — Listar diretório

```bash
curl "http://localhost:7007/api/file-upload/list?repo=meu-repositorio&path=releases"
```

### Exemplo — Deletar arquivo

```bash
curl -X DELETE "http://localhost:7007/api/file-upload/delete?repo=meu-repositorio&path=releases/arquivo.war"
```
