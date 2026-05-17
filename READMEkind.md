# Integração com o Backstage (willsreis/backstageIO)

Este diretório contém os arquivos necessários para integrar o **k9** ao Backstage.

## 📁 Arquivos

| Arquivo | Descrição |
|---|---|
| `create-cluster-template.yaml` | Software Templates: criar e remover clusters Kind |
| `app-config-patch.yaml` | Trecho a adicionar no `app-config.yaml` do Backstage |

---

## 🔧 Como aplicar a integração

### 1. Garantir que o token GitHub tem permissão de `workflow`

O `GITHUB_TOKEN` configurado no Backstage precisa do scope **`workflow`** para disparar GitHub Actions:

1. Acesse https://github.com/settings/tokens
2. Edite o token usado no `GITHUB_TOKEN` do backstageIO
3. Marque o scope **`workflow`** (necessário para `github:actions:dispatch`)

### 2. Atualizar `app-config.yaml` no backstageIO

Abra `willsreis/backstageIO/app-config.yaml` e adicione as localizações abaixo dentro de `catalog.locations`:

```yaml
# K9 — Kind Kubernetes Lab: componente de infraestrutura
- type: url
  target: https://github.com/willsreis/k9/blob/main/catalog-info.yaml
  rules:
    - allow: [Component, System]

# K9 — Kind Kubernetes Lab: templates criar/remover cluster
- type: url
  target: https://github.com/willsreis/k9/blob/main/backstage/create-cluster-template.yaml
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
            └─ willsreis/k9 → setup-cluster.yml
                 └─ self-hosted runner no servidor
                      └─ scripts/setup-cluster.sh
                           └─ kind create cluster
```
