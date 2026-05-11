# backstage-uploader

Um portal Backstage.io customizado que expõe uma interface web para **upload de arquivos binários**, salva os arquivos em disco no diretório `~/data/uploads/` e faz o push automático para o GitHub via API.

---

## Sumário

- [Visão Geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Pré-requisitos](#pré-requisitos)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Executando o Projeto](#executando-o-projeto)
- [Usando o Upload](#usando-o-upload)
- [API de Upload (Backend)](#api-de-upload-backend)
- [Códigos Criados e Seus Caminhos](#códigos-criados-e-seus-caminhos)
- [Fluxo Técnico Detalhado](#fluxo-técnico-detalhado)
- [Variáveis de Ambiente](#variáveis-de-ambiente)

---

## Visão Geral

Este projeto é um app Backstage.io (v1.50.0) com dois plugins customizados:

| Plugin | Tipo | Responsabilidade |
|--------|------|-----------------|
| `@internal/plugin-file-upload` | Frontend | Página com drag-and-drop para selecionar e enviar o arquivo binário |
| `@internal/plugin-file-upload-backend` | Backend | Endpoint REST que recebe o arquivo, persiste em `~/data/uploads/` e faz push para o GitHub |

---

## Arquitetura

```
Browser (React)
  └─ FileUploadPage.tsx  ──POST /api/file-upload/upload──►  Backend Plugin
                                                              ├── multer salva em ~/data/uploads/
                                                              └── @octokit/rest faz push para GitHub
```

---

## Pré-requisitos

| Ferramenta | Versão mínima |
|-----------|--------------|
| Node.js   | 22 (use `.nvmrc`) |
| Yarn      | 4.4.1 (via Corepack) |
| Git       | qualquer |

> **Sem Docker, sem PostgreSQL.** O banco de dados usa SQLite em memória (desenvolvimento).

---

## Estrutura do Projeto

```
serverstage/
├── .env                               ← Variáveis de ambiente (NÃO commitar)
├── .env.example                       ← Template do .env
├── .nvmrc                             ← Versão do Node fixada (22)
├── app-config.yaml                    ← Configuração principal do Backstage
├── package.json                       ← Workspace root (Yarn Berry 4)
├── packages/
│   ├── app/                           ← Frontend (React)
│   │   └── src/
│   │       └── App.tsx               ← Registra o plugin file-upload
│   └── backend/                       ← Backend (Node.js)
│       └── src/
│           └── index.ts              ← Registra o plugin file-upload-backend
└── plugins/
    ├── file-upload/                   ← Plugin Frontend
    │   ├── package.json
    │   └── src/
    │       ├── index.ts
    │       ├── plugin.tsx             ← PageBlueprint (rota /file-upload)
    │       └── components/
    │           └── FileUploadPage.tsx ← UI de upload
    └── file-upload-backend/           ← Plugin Backend
        ├── package.json
        └── src/
            ├── index.ts
            ├── plugin.ts              ← createBackendPlugin (pluginId: 'file-upload')
            └── router.ts             ← Express router com multer + @octokit/rest
```

---

## Instalação

```bash
# 1. Clone e entre no projeto
cd serverstage

# 2. Use a versão correta do Node (requer NVM)
nvm use   # ou: nvm install 22 && nvm use 22

# 3. Habilite o Corepack (uma única vez por máquina)
corepack enable
corepack prepare yarn@4.4.1 --activate

# 4. Instale todas as dependências do monorepo
yarn install
```

> **Nota:** Alguns módulos nativos opcionais (`cpu-features`, etc.) podem emitir warnings de build se as ferramentas de compilação não estiverem instaladas. Isso não afeta o funcionamento do projeto.

---

## Configuração

### 1. Crie o arquivo `.env`

```bash
cp .env.example .env
```

Edite `.env` com seus dados:

```env
# GitHub Personal Access Token (escopos necessários: repo)
GITHUB_TOKEN=ghp_SeuTokenAqui

# Dono do repositório (usuário ou organização)
GITHUB_OWNER=seu-usuario-github

# Nome do repositório de destino (deve existir)
GITHUB_REPO=nome-do-repositorio

# Branch de destino
GITHUB_BRANCH=main
```

### 2. Carregue o `.env` no shell

```bash
# Bash / Zsh
export $(grep -v '^#' .env | xargs)
```

O Backstage lê as variáveis de ambiente automaticamente ao iniciar — o `app-config.yaml` as interpola via `${VARIAVEL}`.

---

## Executando o Projeto

### Backend (porta 7007)

```bash
yarn workspace backend backstage-cli package start
```

### Frontend (porta 3000)

```bash
yarn workspace app backstage-cli package start
```

### Ambos ao mesmo tempo

```bash
yarn start
```

Acesse: **http://localhost:3000**

---

## Usando o Upload

1. Abra **http://localhost:3000/file-upload**
2. Arraste um arquivo binário para a área de drop ou clique para selecionar
3. Clique em **"Upload & Push to GitHub"**
4. O sistema mostra:
   - O caminho local onde o arquivo foi salvo
   - A URL do arquivo no GitHub

---

## API de Upload (Backend)

### `POST /api/file-upload/upload`

Recebe um arquivo binário via `multipart/form-data`.

**Campo do formulário:** `file`

**Exemplo com curl:**

```bash
curl -X POST http://localhost:7007/api/file-upload/upload \
  -F "file=@/caminho/para/seu/arquivo.bin"
```

**Resposta de sucesso (200):**

```json
{
  "message": "File uploaded and pushed to GitHub.",
  "localPath": "/home/usuario/data/uploads/1715000000000-arquivo.bin",
  "github": {
    "owner": "seu-usuario",
    "repo": "nome-repo",
    "branch": "main",
    "path": "uploads/1715000000000-arquivo.bin",
    "url": "https://github.com/seu-usuario/nome-repo/blob/main/uploads/1715000000000-arquivo.bin"
  }
}
```

**Resposta parcial (207 — arquivo salvo, push falhou):**

```json
{
  "message": "File saved locally but GitHub push failed.",
  "localPath": "/home/usuario/data/uploads/1715000000000-arquivo.bin",
  "error": "mensagem de erro do GitHub"
}
```

### `GET /api/file-upload/health`

Retorna status do plugin e o caminho do diretório de upload.

---

## Códigos Criados e Seus Caminhos

### Plugin Backend

#### `plugins/file-upload-backend/package.json`

Define as dependências do plugin backend:
- `@backstage/backend-plugin-api` — API do novo sistema de backend do Backstage
- `multer` — middleware para receber uploads `multipart/form-data`
- `@octokit/rest` — cliente oficial da API do GitHub

#### `plugins/file-upload-backend/src/index.ts`

Ponto de entrada do plugin — re-exporta `fileUploadPlugin` e `createRouter`.

```typescript
export { fileUploadPlugin } from './plugin';
export { createRouter } from './router';
```

#### `plugins/file-upload-backend/src/plugin.ts`

Registra o plugin no sistema de backend do Backstage usando `createBackendPlugin`.
Injeta as dependências `httpRouter`, `config` e `logger`, monta o Express router
e permite acesso não-autenticado à rota `/upload`.

```typescript
import { createBackendPlugin, coreServices } from '@backstage/backend-plugin-api';
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
        httpRouter.addAuthPolicy({ path: '/upload', allow: 'unauthenticated' });
      },
    });
  },
});
```

#### `plugins/file-upload-backend/src/router.ts`

Coração do backend. Responsável por:

1. **Criar o diretório** `~/data/uploads/` se não existir
2. **Configurar o multer** com armazenamento em disco (limite de 100 MB)
3. **`POST /upload`** — salva o arquivo e faz push para o GitHub
4. **`GET /health`** — health check

**Trecho principal da lógica de push:**

```typescript
const octokit = new Octokit({ auth: token });
const fileContent = fs.readFileSync(savedPath);
const base64Content = fileContent.toString('base64');

await octokit.repos.createOrUpdateFileContents({
  owner, repo, branch,
  path: `uploads/${req.file.filename}`,
  message: `chore: upload binary ${req.file.filename}`,
  content: base64Content,
  ...(sha ? { sha } : {}),   // sha necessário para atualizar um arquivo existente
});
```

---

### Plugin Frontend

#### `plugins/file-upload/package.json`

Dependências do plugin frontend:
- `@backstage/frontend-plugin-api` — API do novo sistema de frontend do Backstage
- `@backstage/core-components` — componentes visuais padrão
- `@material-ui/core` e `@material-ui/icons` — UI Material

#### `plugins/file-upload/src/index.ts`

```typescript
export { fileUploadPlugin } from './plugin';
```

#### `plugins/file-upload/src/plugin.tsx`

Cria a extensão de página usando `PageBlueprint` do novo frontend system. Define:
- Rota: `/file-upload`
- Título: "File Upload" (aparece no menu lateral automaticamente)
- Ícone: `CloudUploadIcon`
- Carregamento lazy da página via `import()` dinâmico

```tsx
const fileUploadPage = PageBlueprint.make({
  params: {
    path: '/file-upload',
    title: 'File Upload',
    icon: <CloudUploadIcon fontSize="inherit" />,
    loader: async () => {
      const { FileUploadPage } = await import('./components/FileUploadPage');
      return <FileUploadPage />;
    },
  },
});

export const fileUploadPlugin = createFrontendPlugin({
  pluginId: 'file-upload',
  extensions: [fileUploadPage],
});
```

#### `plugins/file-upload/src/components/FileUploadPage.tsx`

Componente React com:
- **Área de drag-and-drop** para selecionar o arquivo
- **Chip** com nome e tamanho do arquivo selecionado
- **Botão** "Upload & Push to GitHub" (desabilitado sem arquivo)
- **Barra de progresso** durante o upload
- **Painel de resultado** com caminho local e URL do GitHub

O componente usa `configApiRef` do Backstage para ler o `backend.baseUrl` dinamicamente.

---

### Arquivos Modificados

#### `packages/backend/src/index.ts`

Adicionado o import e o registro do plugin:

```typescript
import { fileUploadPlugin } from '@internal/plugin-file-upload-backend';
// ...
backend.add(fileUploadPlugin);
```

#### `packages/app/src/App.tsx`

Adicionado o plugin frontend:

```typescript
import { fileUploadPlugin } from '@internal/plugin-file-upload';

export default createApp({
  features: [catalogPlugin, navModule, fileUploadPlugin],
});
```

#### `app-config.yaml`

Adicionada a seção `fileUpload`:

```yaml
fileUpload:
  github:
    token: ${GITHUB_TOKEN}
    owner: ${GITHUB_OWNER}
    repo: ${GITHUB_REPO}
    branch: ${GITHUB_BRANCH}
    targetDir: uploads
```

---

## Fluxo Técnico Detalhado

```
1. Usuário acessa http://localhost:3000/file-upload
2. React carrega FileUploadPage.tsx
3. Usuário seleciona/arrasta arquivo binário
4. Clica em "Upload & Push to GitHub"
5. Browser envia POST multipart/form-data para http://localhost:7007/api/file-upload/upload
6. Backend (router.ts):
   a. multer intercepta o upload e salva em ~/data/uploads/<timestamp>-<nome>
   b. Lê o arquivo do disco como Buffer
   c. Converte para Base64
   d. Cria Octokit com GITHUB_TOKEN
   e. Verifica se o arquivo já existe no repo (para obter o sha)
   f. Chama octokit.repos.createOrUpdateFileContents()
   g. Retorna JSON com localPath e URL do GitHub
7. Frontend exibe o resultado com links clicáveis
```

---

## Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `GITHUB_TOKEN` | ✅ | PAT do GitHub (escopo: `repo`) |
| `GITHUB_OWNER` | ✅ | Usuário ou organização donos do repo |
| `GITHUB_REPO` | ✅ | Nome do repositório de destino |
| `GITHUB_BRANCH` | ✅ | Branch de destino (ex: `main`) |

> O arquivo `.env` **já está no `.gitignore`**. Nunca commite tokens.

---

## Limitações Conhecidas

- Tamanho máximo de arquivo: **100 MB** (limite da API de Conteúdo do GitHub)
- Para arquivos maiores, seria necessário usar Git LFS
- O backend usa SQLite em memória (dados do catálogo não persistem entre reinicializações)

---

## Como Gerar o Token PAT

1. Acesse https://github.com/settings/tokens
2. Clique em **"Generate new token (classic)"**
3. Selecione o escopo **`repo`** (acesso completo ao repositório)
4. Copie o token gerado e cole em `GITHUB_TOKEN` no `.env`
