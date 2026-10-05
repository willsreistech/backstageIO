# RBAC Keycloak / Backstage — laboratório, 2026-10-05

## Diagnóstico e atualização

O Keycloak já tinha os 11 grupos do contrato atualizado. O Backstage ainda
executava a imagem de 10 de setembro, sem `artifact-deleters`, `eks-deployers`
e `eks-destroyers`. O deploy da revisão `753e190` falhou porque o runner
self-hosted perdeu comunicação com o GitHub durante o build:
<https://github.com/willsreistech/backstageIO/actions/runs/37298179436>.
Isso não comprova falta de memória; a causa da desconexão não foi determinada.

A recuperação foi aplicada em `192.168.1.250`, `/home/wsr/backstage`:

- Imagem ativa: `backstage:rbac-753e190`.
- Image ID: `sha256:97d2b8487b1f7ba2afc3fa7ffddb440f9248472cfa5ccae934f1709111000ed7`.
- Base preservada: `backstage:rbac-base-20261005`, image ID
  `sha256:b4826594db3fa7ffcdf6327c82d8f794f4d69ee42e25265a8b630750f25f1ded`.
- Compilação local do backend e do plugin de arquivos a partir de `753e190`.
  A imagem incremental substitui a política compilada, o router de arquivos
  e `app-config.yaml`. O arquivo montado `app-config.deploy.yaml` também foi
  atualizado a partir da mesma revisão.
- O SHA-256 de `yarn.lock` local e da imagem base é idêntico:
  `3d5eca091d1c91f868e1084640af5dc04e5dad80b8850c135e1dd339b3a4aa5d`.
  As configurações anteriores também foram comparadas com a revisão base.
- `.env` agora seleciona a imagem identificada acima. Somente o serviço
  `backstage` foi recriado, usando `docker compose up -d --no-deps backstage`.

Essa recuperação não altera o resultado do workflow nem corrige a causa da
desconexão do runner. O próximo deploy completo continua usando o Dockerfile
versionado e deverá concluir seu build antes de substituir esta imagem.

## Verificações

- TypeScript sem erros; 20 testes da política e 5 testes HTTP de arquivos passaram.
- 40 decisões de autorização passaram contra o código compilado da nova imagem,
  em container isolado, sem disparar workflows.
- Portal HTTP 200; início do login OIDC HTTP 302; API de permissões sem sessão
  HTTP 401. O login completo no navegador ainda precisa ser validado pelo usuário.
- Relações dos usuários no catálogo correspondem aos grupos do Keycloak.
- Locations do Terraform, componente `terraform-eks`, sistema `eks-aws` e
  templates `deploy-terraform-eks` / `destroy-terraform-eks` foram processados
  sem erros. Nenhum deploy ou destroy de infraestrutura foi executado.

Os vínculos dos usuários foram preservados:

| Usuário | Grupos atuais |
|---|---|
| `teste` | `artifact-viewers`, `artifact-uploaders`, `cluster-creators`, `eks-deployers` |
| `zezinho` | `artifact-viewers` |
| `wsr` | `artifact-publisher`, `platform-admin` |

O exemplo de Zezinho no README descreve um perfil possível, não os vínculos
atuais dessa conta. No estado validado, Zezinho somente visualiza arquivos.
Após mudar grupos no Keycloak, aguardar a sincronização e renovar o login.

## Rollback desta atualização

No servidor, as cópias anteriores são `.env.before-rbac-753e190` (modo 0600)
e `app-config.deploy.yaml.before-rbac-753e190`. A primeira contém segredos:
nunca imprimir, versionar ou publicar seu conteúdo.

Somente para reverter esta atualização, antes de mudanças posteriores:

```sh
cd /home/wsr/backstage
cp -p .env.before-rbac-753e190 .env
cp -p app-config.deploy.yaml.before-rbac-753e190 app-config.deploy.yaml
BACKSTAGE_IMAGE=backstage:rbac-base-20261005 docker compose config --quiet
BACKSTAGE_IMAGE=backstage:rbac-base-20261005 docker compose up -d --no-deps backstage
```

O rollback restaura a política antiga; não remove entidades já ingeridas do
catálogo e não muda usuários, grupos ou memberships do Keycloak.
