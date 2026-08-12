# Integração com o Backstage (willsreistech/backstageIO)

Este diretório contém os arquivos necessários para integrar o **k9** ao Backstage.

## 📁 Arquivos

| Arquivo | Descrição |
|---|---|
| `create-cluster-template.yaml` | Software Templates: criar e remover clusters Kind |
| `app-config-patch.yaml` | Trecho a adicionar no `app-config.yaml` do Backstage |

---

## 🔧 Como aplicar a integração

### 1. Configurar o GitHub App

Crie um GitHub App dedicado ao Backstage e instale-o somente em
`willsreistech/k9`. Conceda:

- `Actions: Read and write` para disparar workflows;
- `Contents: Read` para catálogo e leitura de arquivos;
- `Contents: Write` somente se o plugin de upload for utilizado.

Adicione estes secrets ao Environment `production` do `backstageIO`:

```text
BACKSTAGE_GH_APP_ID
BACKSTAGE_GH_APP_CLIENT_ID
BACKSTAGE_GH_APP_CLIENT_SECRET
BACKSTAGE_GH_APP_PRIVATE_KEY_B64
```

Gere o último valor com:

```bash
base64 -w0 app.private-key.pem
```

O deploy decodifica a chave somente dentro do container. Depois de criar ou
alterar o App, execute o deploy do Backstage para carregar as credenciais.

### 2. Atualizar `app-config.yaml` no backstageIO

Abra `willsreistech/backstageIO/app-config.yaml` e adicione as localizações abaixo dentro de `catalog.locations`:

```yaml
# K9 — Kind Kubernetes Lab: componente de infraestrutura
- type: url
  target: https://github.com/willsreistech/k9/blob/main/catalog-info.yaml
  rules:
    - allow: [Component, System]

# K9 — Kind Kubernetes Lab: templates criar/remover cluster
- type: url
  target: https://github.com/willsreistech/k9/blob/main/backstage/create-cluster-template.yaml
  rules:
    - allow: [Template]
```

> O arquivo `backstage/app-config-patch.yaml` tem o trecho completo para copiar.

### 3. Fazer push do k9 e reiniciar o Backstage

```bash
# No repo k9 — commit e push dos novos arquivos
git add catalog-info.yaml backstage/
git commit -m "feat: add Backstage catalog and scaffolder templates"
git push

# No servidor com o Backstage — reiniciar para recarregar o catalog
yarn start   # ou o comando que você usa para rodar o Backstage
```

### 4. Resultado no Backstage

Após reiniciar o Backstage você terá:

- **Catalog → Components** → `k9-kind-lab` (infraestrutura Kind)
- **Create → Templates** →  
  - 🚀 `Criar Cluster Kind` — pede o nome e dispara `setup-cluster.yml`  
  - 🗑️ `Remover Cluster Kind` — pede o nome e dispara `teardown-cluster.yml`

---

## 🔄 Fluxo completo

```
Backstage UI
  └─ Template "Criar Cluster Kind"
       └─ github:actions:dispatch
            └─ willsreistech/k9 → setup-cluster.yml
                 └─ self-hosted runner no servidor
                      └─ scripts/setup-cluster.sh
                           └─ kind create cluster
```
