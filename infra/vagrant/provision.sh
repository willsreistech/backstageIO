#!/usr/bin/env bash
set -e

echo "🚀 Iniciando provisionamento Backstage Dev Environment"

# -----------------------------
# Atualização básica do sistema
# -----------------------------
sudo apt-get update -y
sudo apt-get upgrade -y

# -----------------------------
# Dependências essenciais
# -----------------------------
sudo apt-get install -y \
  curl \
  wget \
  git \
  build-essential \
  ca-certificates \
  gnupg \
  unzip

# -----------------------------
# Git (via PPA opcional)
# -----------------------------
sudo add-apt-repository ppa:git-core/ppa -y
sudo apt-get update -y
sudo apt-get install -y git

echo "✅ Git instalado:"
git --version

# -----------------------------
# Node.js 22 (Hydrogen)
# -----------------------------
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "✅ Node instalado:"
node -v
npm -v

# -----------------------------
# Yarn (via Corepack)
# -----------------------------
corepack enable
corepack prepare yarn@stable --activate

echo "✅ Yarn instalado:"
yarn -v

# -----------------------------
# Ajustes de sistema recomendados
# -----------------------------
# Watchers para webpack/rspack
echo "fs.inotify.max_user_watches=1048576" | sudo tee -a /etc/sysctl.conf

# Limite de arquivos abertos (Backstage usa MUITO)
echo "fs.file-max=2097152" | sudo tee -a /etc/sysctl.conf
echo "* soft nofile 1048576" | sudo tee -a /etc/security/limits.conf
echo "* hard nofile 1048576" | sudo tee -a /etc/security/limits.conf

sudo sysctl -p

# -----------------------------
# Usuário vagrant preparado
# -----------------------------
sudo chown -R vagrant:vagrant /home/vagrant

echo "🎉 Provisionamento finalizado com sucesso!"
echo "➡️ Acesse a VM e rode: npx @backstage/create-app@latest"

echo "➡️ Dentro da VM, execute:"
echo "cd /vagrant"
echo "npx @backstage/create-app@latest --skip-install"
