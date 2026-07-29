#!/usr/bin/env bash
#
# fix-fortigate-ca.sh — Instala os certificados INTERMEDIÁRIOS que faltam para o
# Node.js confiar nos endpoints HTTPS usados pelo Backstage (GitHub, etc.).
#
# ── POR QUE ISTO EXISTE ──────────────────────────────────────────────────────
# O runner self-hosted atual fica atrás de um FortiGate com SSL-inspection. Para
# vários hosts (ex.: api.github.com) o FortiGate NÃO reassina o certificado, mas
# ENTREGA A CADEIA INCOMPLETA — manda só o certificado "leaf" e remove o
# intermediário. Com isso:
#
#   • `curl` FUNCIONA   -> usa o CApath com hash (/etc/ssl/certs/*.0) e consegue
#                          achar o intermediário no disco para montar a cadeia.
#   • Node.js FALHA     -> `NODE_EXTRA_CA_CERTS` carrega só um arquivo FLAT (sem
#                          CApath), então o intermediário ausente na cadeia não é
#                          encontrado -> "unable to verify the first certificate".
#
# A correção é colocar o(s) intermediário(s) DENTRO do bundle flat que o
# NODE_EXTRA_CA_CERTS aponta. Este script descobre o intermediário faltante pela
# extensão AIA (Authority Information Access) do leaf, baixa via `curl` (que passa
# no proxy), instala em /usr/local/share/ca-certificates/ e roda
# `update-ca-certificates` (que regenera /etc/ssl/certs/ca-certificates.crt
# incluindo o intermediário).
#
# ── NOVA ARQUITETURA ─────────────────────────────────────────────────────────
# Sem FortiGate / sem SSL-inspection a cadeia chega completa e ESTE SCRIPT É
# DESNECESSÁRIO. Ele é um workaround do ambiente inspecionado, seguro para
# remover quando a migração concluir.
#
# ── USO ──────────────────────────────────────────────────────────────────────
#   sudo ./scripts/fix-fortigate-ca.sh                # hosts padrão do GitHub
#   sudo ./scripts/fix-fortigate-ca.sh api.github.com raw.githubusercontent.com
#
# Requer: bash, curl, openssl, sudo (para instalar no store do sistema).
# Idempotente: hosts cuja cadeia já valida são pulados.
#
set -euo pipefail

CA_DIR="/usr/local/share/ca-certificates"
SYSTEM_BUNDLE="/etc/ssl/certs/ca-certificates.crt"
MAX_DEPTH=4  # segue a cadeia AIA por até N níveis (leaf -> intermediários)

# Hosts que o backend do Backstage acessa por HTTPS (catálogo/integrations/techdocs).
DEFAULT_HOSTS=(
  api.github.com
  github.com
  codeload.github.com
  raw.githubusercontent.com
  objects.githubusercontent.com
)

HOSTS=("$@")
if [ "${#HOSTS[@]}" -eq 0 ]; then
  HOSTS=("${DEFAULT_HOSTS[@]}")
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "ERRO: rode com sudo (preciso escrever em ${CA_DIR} e rodar update-ca-certificates)." >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

installed_any=0

# Baixa e normaliza (DER->PEM) um certificado de uma URL AIA. Ecoa o caminho PEM.
fetch_issuer_pem() {
  local url="$1" out_der="$2" out_pem="$3"
  if ! curl -fsSL "$url" -o "$out_der"; then
    return 1
  fi
  if openssl x509 -in "$out_der" -inform DER -noout >/dev/null 2>&1; then
    openssl x509 -in "$out_der" -inform DER -out "$out_pem"
  elif openssl x509 -in "$out_der" -inform PEM -noout >/dev/null 2>&1; then
    cp "$out_der" "$out_pem"
  else
    return 1
  fi
}

# Primeira URI de "CA Issuers" na extensão AIA de um cert PEM.
aia_ca_issuers_url() {
  openssl x509 -in "$1" -noout -ext authorityInfoAccess 2>/dev/null \
    | sed -n 's/.*CA Issuers - URI://p' | head -1 | tr -d '[:space:]'
}

for host in "${HOSTS[@]}"; do
  echo "── ${host} ────────────────────────────────────────────"
  # Captura a cadeia COMPLETA apresentada pelo servidor (leaf + intermediários
  # que ele mandar). Atrás do FortiGate normalmente vem só o leaf.
  presented="${tmp}/${host}.presented.pem"
  leaf="${tmp}/${host}.leaf.pem"
  if ! echo | openssl s_client -connect "${host}:443" -servername "$host" -showcerts 2>/dev/null \
        | sed -n '/BEGIN CERTIFICATE/,/END CERTIFICATE/p' > "$presented" || [ ! -s "$presented" ]; then
    echo "  aviso: não consegui obter o certificado de ${host}, pulando."
    continue
  fi
  # O leaf é o primeiro certificado da cadeia apresentada.
  openssl x509 -in "$presented" -out "$leaf" 2>/dev/null

  # Já valida usando a cadeia apresentada + roots do sistema?
  if openssl verify -CAfile "$SYSTEM_BUNDLE" -untrusted "$presented" "$leaf" >/dev/null 2>&1; then
    echo "  OK: cadeia apresentada já valida com o bundle do sistema. Nada a fazer."
    continue
  fi

  echo "  cadeia incompleta detectada; seguindo AIA para achar intermediário(s)..."
  # 'untrusted' acumula os intermediários conhecidos (apresentados + baixados).
  untrusted="${tmp}/${host}.untrusted.pem"
  cp "$presented" "$untrusted"
  current="$leaf"
  depth=0
  while [ "$depth" -lt "$MAX_DEPTH" ]; do
    url="$(aia_ca_issuers_url "$current")"
    if [ -z "$url" ]; then
      echo "  aviso: sem URL de CA Issuers no AIA; não dá para completar automaticamente."
      break
    fi
    der="${tmp}/int.${host}.${depth}.der"
    pem="${tmp}/int.${host}.${depth}.pem"
    if ! fetch_issuer_pem "$url" "$der" "$pem"; then
      echo "  aviso: falha ao baixar/normalizar intermediário de ${url}."
      break
    fi
    subj="$(openssl x509 -in "$pem" -noout -subject | sed 's/^subject=//')"
    # nome de arquivo estável e único por subject-hash
    fname="fortigate-$(openssl x509 -in "$pem" -noout -subject_hash).crt"
    cp "$pem" "${CA_DIR}/${fname}"
    cat "$pem" >> "$untrusted"
    installed_any=1
    echo "  + instalado intermediário: ${subj}"
    echo "    -> ${CA_DIR}/${fname}"

    # A cadeia já fecha num root confiável do sistema?
    if openssl verify -CAfile "$SYSTEM_BUNDLE" -untrusted "$untrusted" "$leaf" >/dev/null 2>&1; then
      echo "  cadeia completável com este intermediário. Feito para ${host}."
      break
    fi
    current="$pem"
    depth=$((depth + 1))
  done
done

if [ "$installed_any" -eq 1 ]; then
  echo "── atualizando o store do sistema (update-ca-certificates) ──"
  update-ca-certificates
else
  echo "Nenhum intermediário novo precisou ser instalado."
fi

echo
echo "── verificação final com Node.js ──"
for host in "${HOSTS[@]}"; do
  NODE_EXTRA_CA_CERTS="$SYSTEM_BUNDLE" node -e "
    require('https').get('https://${host}',{headers:{'User-Agent':'backstage-ca-check'},timeout:8000},r=>{console.log('  NODE OK  ${host} ->',r.statusCode);r.destroy();})
      .on('error',e=>console.log('  NODE ERR ${host} ->',e.message))
      .on('timeout',function(){console.log('  NODE TIMEOUT ${host}');this.destroy();});
  " || true
done

echo
echo "Pronto. Se todos acima mostrarem 'NODE OK', o backend do Backstage já"
echo "consegue ler os catálogos (ex.: k9) por HTTPS. Reinicie com: yarn start"
