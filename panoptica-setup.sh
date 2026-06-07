#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# PANOPTICA — Server Setup Script (Disaster-Recovery Edition)
# Prepares a fresh Ubuntu 24.04 LTS server to run Panoptica365.
#
# Replaces the original panoptica-setup.sh AND ps-setup.sh.
# ps-setup.sh is now obsolete — keep it around only for reference.
#
# What this script installs and configures:
#   ─── Base infrastructure ────────────────────────────────────────
#   • System update + timezone (America/Toronto)
#   • Essentials: curl, git, build-essential, openssh-server, jq, unzip
#   • Node.js 20 LTS (via nvm, installed for the real user)
#   • PM2 (Node process manager) + systemd startup hook
#   • MySQL 8 (with `panoptica` database + dedicated user)
#   • Nginx (reverse proxy, HTTP→HTTPS redirect, self-signed TLS)
#   • Samba (single share for Mac SMB editing)
#   • UFW firewall (22, 80, 443, 445)
#   • SSH server enabled
#
#   ─── Microsoft tooling for Phase B Security Settings ────────────
#   • PowerShell 7.x (latest from packages.microsoft.com)
#   • ExchangeOnlineManagement module
#   • Microsoft.Online.SharePoint.PowerShell module
#   • MicrosoftTeams module
#
#   ─── PDF report generation ──────────────────────────────────────
#   • Python 3 venv at /opt/panoptica/venv with ReportLab
#
#   ─── Graph app-only authentication ──────────────────────────────
#   • Self-signed 4096-bit RSA cert (2-year validity) at
#     /opt/panoptica/certs/panoptica-graph.{pfx,cer,crt,key,thumbprint}
#   • ⚠ ALWAYS generates a fresh cert. After running, you MUST
#     upload the new .cer to the Entra app registration and update
#     GRAPH_CERT_THUMBPRINT in /opt/panoptica/.env.
#
#   ─── Project scaffolding ────────────────────────────────────────
#   • /opt/panoptica directory tree (skipped if already populated)
#   • /opt/panoptica/.env.template with every key currently in use
#
# What this script does NOT do (manual steps after running):
#   • Restore the database from your nightly mysqldump
#   • Restore /opt/panoptica from your QNAP NAS backup
#   • Run `npm install` (do this AFTER restoring package.json)
#   • Re-create cron jobs for backups (see DR-RESTORE.md)
#   • Upload the new Graph cert to Entra (printed at end)
#   • Set a static IP / DNS records
#
# Usage:
#   chmod +x panoptica-setup.sh
#   sudo ./panoptica-setup.sh
#
# Idempotent in the safe parts (apt, nvm, pm2, modules). DESTRUCTIVE
# in the cert-generation step — overwrites any existing cert. The
# script asks for explicit "PROCEED" confirmation before doing
# anything to protect against accidental runs on a healthy server.
#
# Trilogiam Technologies — May 2026
# ═══════════════════════════════════════════════════════════════════

set -e

# ─── Colors for output ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Must be run as root via sudo ───
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}ERROR: This script must be run with sudo.${NC}"
    echo "Usage: sudo ./panoptica-setup.sh"
    exit 1
fi

# ─── Identify the real (non-root) user ───
REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME=$(eval echo "~$REAL_USER")

if [ "$REAL_USER" = "root" ]; then
    echo -e "${RED}ERROR: Don't run this as root directly.${NC}"
    echo "Run it as your normal user with sudo: sudo ./panoptica-setup.sh"
    exit 1
fi

# ─── Cert defaults ───
CERT_DIR="/opt/panoptica/certs"
CERT_NAME="panoptica-graph"
CERT_DAYS=730            # 2 years
CERT_KEY_BITS=4096
CERT_SUBJECT="/CN=Panoptica365 Graph Service/O=Panoptica365"

# ─── Detect whether this looks like an existing install ───
EXISTING_INSTALL=0
if [ -f /opt/panoptica/.env ] || [ -f /opt/panoptica/package.json ]; then
    EXISTING_INSTALL=1
fi

# ─── Banner ───
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}   PANOPTICA — Server Setup (DR Edition)${NC}"
echo -e "${CYAN}   The All-Seeing Eye${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Running as user: ${GREEN}$REAL_USER${NC}"
echo -e "  Home directory:  ${GREEN}$REAL_HOME${NC}"
echo ""

# ─── Loud destructive-action warning ───
if [ "$EXISTING_INSTALL" = "1" ]; then
    echo -e "${RED}${BOLD}⚠  EXISTING INSTALL DETECTED${NC}"
    echo -e "${RED}/opt/panoptica/.env or /opt/panoptica/package.json already exist.${NC}"
    echo ""
    echo -e "${YELLOW}If you continue, this script will:${NC}"
    echo -e "  ${YELLOW}• OVERWRITE the Graph cert at /opt/panoptica/certs/  →${NC}"
    echo -e "    ${YELLOW}  the old thumbprint in Entra will no longer match,${NC}"
    echo -e "    ${YELLOW}  Phase B Security Settings will break until you${NC}"
    echo -e "    ${YELLOW}  upload the new .cer and update .env.${NC}"
    echo -e "  ${YELLOW}• RESET the UFW firewall to script defaults${NC}"
    echo -e "  ${YELLOW}• OVERWRITE /etc/nginx/sites-available/panoptica${NC}"
    echo -e "  ${YELLOW}• OVERWRITE the self-signed nginx TLS cert${NC}"
    echo ""
    echo -e "${YELLOW}It will NOT touch:${NC}"
    echo -e "  ${GREEN}• /opt/panoptica/.env (your live config)${NC}"
    echo -e "  ${GREEN}• MySQL data or schema${NC}"
    echo -e "  ${GREEN}• /opt/panoptica/src, locales, public, scripts, etc.${NC}"
    echo ""
fi

echo -e "${YELLOW}This is a disaster-recovery script. It assumes a fresh${NC}"
echo -e "${YELLOW}Ubuntu 24.04 server. Type ${BOLD}PROCEED${NC}${YELLOW} (in caps) to continue,${NC}"
echo -e "${YELLOW}or anything else to abort.${NC}"
echo ""
read -p "$(echo -e ${BLUE})Confirmation: $(echo -e ${NC})" CONFIRM
if [ "$CONFIRM" != "PROCEED" ]; then
    echo -e "${RED}Aborted.${NC}"
    exit 1
fi
echo ""

# ─── Collect passwords + hostname upfront ───
echo -e "${YELLOW}I need a few inputs before installing:${NC}"
echo ""

# MySQL root password
while true; do
    read -sp "$(echo -e ${BLUE})MySQL root password (set strong): $(echo -e ${NC})" MYSQL_ROOT_PASS
    echo ""
    read -sp "$(echo -e ${BLUE})Confirm MySQL root password: $(echo -e ${NC})" MYSQL_ROOT_PASS2
    echo ""
    if [ "$MYSQL_ROOT_PASS" = "$MYSQL_ROOT_PASS2" ] && [ -n "$MYSQL_ROOT_PASS" ]; then
        break
    fi
    echo -e "${RED}Passwords don't match or are empty. Try again.${NC}"
done
echo ""

# MySQL panoptica user password — MUST match the DB_PASS in your .env
echo -e "${YELLOW}NOTE: The 'panoptica' MySQL user password MUST match DB_PASS${NC}"
echo -e "${YELLOW}in your /opt/panoptica/.env (otherwise the app can't connect).${NC}"
while true; do
    read -sp "$(echo -e ${BLUE})MySQL 'panoptica' user password: $(echo -e ${NC})" MYSQL_APP_PASS
    echo ""
    read -sp "$(echo -e ${BLUE})Confirm: $(echo -e ${NC})" MYSQL_APP_PASS2
    echo ""
    if [ "$MYSQL_APP_PASS" = "$MYSQL_APP_PASS2" ] && [ -n "$MYSQL_APP_PASS" ]; then
        break
    fi
    echo -e "${RED}Passwords don't match or are empty. Try again.${NC}"
done
echo ""

# Samba password
while true; do
    read -sp "$(echo -e ${BLUE})Samba password (for SMB mount from your Mac): $(echo -e ${NC})" SAMBA_PASS
    echo ""
    read -sp "$(echo -e ${BLUE})Confirm: $(echo -e ${NC})" SAMBA_PASS2
    echo ""
    if [ "$SAMBA_PASS" = "$SAMBA_PASS2" ] && [ -n "$SAMBA_PASS" ]; then
        break
    fi
    echo -e "${RED}Passwords don't match or are empty. Try again.${NC}"
done
echo ""

# Hostname — default to production value
read -p "$(echo -e ${BLUE})Server hostname [panoptica.trilogiam.net]: $(echo -e ${NC})" SERVER_HOSTNAME
SERVER_HOSTNAME="${SERVER_HOSTNAME:-panoptica.trilogiam.net}"
echo ""

# ─── Confirmation summary ───
echo -e "${YELLOW}Ready to install. Estimated time: 8-15 minutes.${NC}"
echo -e "  MySQL root password:     ${GREEN}(set)${NC}"
echo -e "  MySQL app user password: ${GREEN}(set)${NC}"
echo -e "  Samba password:          ${GREEN}(set)${NC}"
echo -e "  Server hostname:         ${GREEN}$SERVER_HOSTNAME${NC}"
echo ""
read -p "$(echo -e ${YELLOW})Press Enter to start, or Ctrl+C to cancel... $(echo -e ${NC})"
echo ""

# ─── Step tracker ───
STEP=0
TOTAL_STEPS=16
step() {
    STEP=$((STEP + 1))
    echo ""
    echo -e "${CYAN}[$STEP/$TOTAL_STEPS] $1${NC}"
    echo -e "${CYAN}$(printf '─%.0s' {1..60})${NC}"
}

# ═══════════════════════════════════════════════════════════════
# STEP 1: System update + timezone
# ═══════════════════════════════════════════════════════════════
step "Updating system packages and setting timezone"

export DEBIAN_FRONTEND=noninteractive
apt update
apt upgrade -y

# Match production timezone — Panoptica's MySQL session timezone
# follows the system clock, and JS-converted UTC datetimes assume
# Eastern. Don't change this casually.
timedatectl set-timezone America/Toronto

echo -e "${GREEN}✓ System updated, timezone = America/Toronto${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 2: Essential packages
# ═══════════════════════════════════════════════════════════════
step "Installing essential packages"

apt install -y \
    curl \
    git \
    build-essential \
    net-tools \
    openssh-server \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    jq \
    unzip \
    rsync \
    python3 \
    python3-venv \
    python3-pip

systemctl enable ssh
systemctl start ssh

echo -e "${GREEN}✓ Essentials installed (incl. SSH server, jq, rsync, python3)${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 3: Node.js 20 LTS via nvm (as REAL_USER)
# ═══════════════════════════════════════════════════════════════
step "Installing Node.js 20 LTS via nvm"

sudo -u "$REAL_USER" bash -c '
    export HOME="'"$REAL_HOME"'"
    if [ ! -s "$HOME/.nvm/nvm.sh" ]; then
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    fi
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    nvm install 20
    nvm use 20
    nvm alias default 20
'

NODE_VERSION=$(sudo -u "$REAL_USER" bash -c '
    export NVM_DIR="'"$REAL_HOME"'/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    node --version
')
echo -e "${GREEN}✓ Node.js installed: $NODE_VERSION${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 4: PM2 + systemd startup hook
# ═══════════════════════════════════════════════════════════════
step "Installing PM2 + configuring systemd auto-start"

sudo -u "$REAL_USER" bash -c '
    export NVM_DIR="'"$REAL_HOME"'/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    npm install -g pm2
'

# Capture pm2 path so we can run pm2 startup as root
PM2_PATH=$(sudo -u "$REAL_USER" bash -c '
    export NVM_DIR="'"$REAL_HOME"'/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    which pm2
')

# Register pm2 with systemd so it auto-starts on boot
env PATH="$PATH:$(dirname $PM2_PATH)" pm2 startup systemd -u "$REAL_USER" --hp "$REAL_HOME" 2>/dev/null || true

echo -e "${GREEN}✓ PM2 installed; will auto-start on boot once you 'pm2 save'${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 5: MySQL 8
# ═══════════════════════════════════════════════════════════════
step "Installing MySQL 8 + creating panoptica DB and user"

apt install -y mysql-server
systemctl enable mysql
systemctl start mysql

# Set root password and create db + user. Idempotent — re-running is safe.
mysql -u root <<MYSQL_SCRIPT
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${MYSQL_ROOT_PASS}';
CREATE DATABASE IF NOT EXISTS panoptica CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'panoptica'@'localhost' IDENTIFIED BY '${MYSQL_APP_PASS}';
ALTER USER 'panoptica'@'localhost' IDENTIFIED BY '${MYSQL_APP_PASS}';
GRANT ALL PRIVILEGES ON panoptica.* TO 'panoptica'@'localhost';
FLUSH PRIVILEGES;
MYSQL_SCRIPT

# Verify
mysql -u panoptica -p"${MYSQL_APP_PASS}" -e "SELECT 'panoptica DB connection OK' AS status;" panoptica

echo -e "${GREEN}✓ MySQL ready (user 'panoptica', database 'panoptica')${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 6: Nginx + self-signed TLS
# ═══════════════════════════════════════════════════════════════
step "Installing Nginx + generating self-signed TLS cert"

apt install -y nginx
systemctl enable nginx

mkdir -p /etc/nginx/ssl
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/panoptica.key \
    -out /etc/nginx/ssl/panoptica.crt \
    -subj "/CN=$SERVER_HOSTNAME" \
    2>/dev/null

cat > /etc/nginx/sites-available/panoptica <<NGINX_CONF
server {
    listen 80;
    server_name $SERVER_HOSTNAME;
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl;
    server_name $SERVER_HOSTNAME;

    ssl_certificate /etc/nginx/ssl/panoptica.crt;
    ssl_certificate_key /etc/nginx/ssl/panoptica.key;

    # Larger upload size for backup downloads + report PDFs
    client_max_body_size 50M;

    # WebSocket support for Socket.IO (real-time alerts)
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
NGINX_CONF

ln -sf /etc/nginx/sites-available/panoptica /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl restart nginx

echo -e "${GREEN}✓ Nginx configured (HTTP→HTTPS, proxy to :3000, WS support)${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 7: PowerShell 7 (Microsoft apt repo)
# ═══════════════════════════════════════════════════════════════
step "Installing PowerShell 7"

. /etc/os-release
UBUNTU_VERSION="$VERSION_ID"
UBUNTU_CODENAME="$VERSION_CODENAME"

if [ "$ID" != "ubuntu" ]; then
    echo -e "${RED}ERROR: This script targets Ubuntu only. Detected: $PRETTY_NAME${NC}"
    exit 1
fi

case "$UBUNTU_CODENAME" in
    noble|jammy|focal)
        MS_REPO_SUFFIX="$UBUNTU_VERSION"
        ;;
    *)
        echo -e "${YELLOW}WARN: Ubuntu $UBUNTU_CODENAME is not a known LTS — falling back to 24.04 repo${NC}"
        MS_REPO_SUFFIX="24.04"
        ;;
esac

# Microsoft signing key (idempotent)
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
    | gpg --dearmor --yes -o /usr/share/keyrings/microsoft.gpg

# Repo list (idempotent — same content each time)
cat > /etc/apt/sources.list.d/microsoft-powershell.list <<REPO_CONF
deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/ubuntu/${MS_REPO_SUFFIX}/prod ${UBUNTU_CODENAME} main
REPO_CONF

apt update
apt install -y powershell

PWSH_VERSION=$(pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()')
echo -e "${GREEN}✓ PowerShell $PWSH_VERSION installed${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 8: PowerShell modules (as REAL_USER, Scope=CurrentUser)
# ═══════════════════════════════════════════════════════════════
step "Installing PowerShell modules (Exchange, SharePoint, Teams)"

# Modules MUST be installed as the user that runs pwsh at runtime.
# Installing as root + CurrentUser puts them in /root/.local/... where
# the service user can't see them.
sudo -u "$REAL_USER" pwsh -NoProfile -NonInteractive -Command "
    \$ErrorActionPreference = 'Stop'
    Set-PSRepository -Name PSGallery -InstallationPolicy Trusted
    Write-Host '  Installing ExchangeOnlineManagement...'
    Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber
    Write-Host '  Installing Microsoft.Online.SharePoint.PowerShell...'
    Install-Module -Name Microsoft.Online.SharePoint.PowerShell -Scope CurrentUser -Force -AllowClobber
    Write-Host '  Installing MicrosoftTeams...'
    Install-Module -Name MicrosoftTeams -Scope CurrentUser -Force -AllowClobber
"

# Verify each module imports cleanly
sudo -u "$REAL_USER" pwsh -NoProfile -NonInteractive -Command "
    \$ErrorActionPreference = 'Stop'
    Import-Module ExchangeOnlineManagement -ErrorAction Stop
    Import-Module Microsoft.Online.SharePoint.PowerShell -ErrorAction Stop
    Import-Module MicrosoftTeams -ErrorAction Stop
    Write-Host ''
    Write-Host 'Loaded modules:'
    Get-Module | Where-Object { \$_.Name -in 'ExchangeOnlineManagement','Microsoft.Online.SharePoint.PowerShell','MicrosoftTeams' } | Format-Table Name, Version
"

echo -e "${GREEN}✓ All three modules installed and importable${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 9: Project directory scaffolding
# ═══════════════════════════════════════════════════════════════
step "Creating project directory structure"

# Only create skeletal dirs if /opt/panoptica is empty or doesn't exist.
# If you've already restored from backup, this is a no-op.
mkdir -p /opt/panoptica/{src,config,locales,public,public/css,public/js,logs,scripts,backups,certs,sysconfig}

# .env.template — the canonical list of every config key Panoptica
# currently reads. Compared to the original setup script: adds
# Notification, Entra group IDs (3 tiers + alias), Graph cert keys.
cat > /opt/panoptica/.env.template <<ENV_TEMPLATE
# ═══ Panoptica Configuration ═══
# Copy this file to .env, fill in values. Never commit .env to git.

# ─── Server ───
PORT=3000
NODE_ENV=production

# ─── MySQL ───
DB_HOST=localhost
DB_PORT=3306
DB_NAME=panoptica
DB_USER=panoptica
DB_PASS=YOUR_MYSQL_APP_PASSWORD

# ─── Anthropic (Claude AI for analysis + tenant digests) ───
ANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY

# ─── SMTP2GO (email notifications) ───
SMTP_HOST=mail.smtp2go.com
SMTP_PORT=2525
SMTP_USER=YOUR_SMTP2GO_USERNAME
SMTP_PASS=YOUR_SMTP2GO_PASSWORD
SMTP_FROM=alerts@panoptica365.ca

# ─── Notification routing ───
PSA_EMAIL=support@trilogiam.ca
PSA_ATTRIBUTION=//\${PSA_NAME}//
NOTIFY_EMAILS=jacques.sauve@trilogiam.ca

# ─── Session secret (regenerate with: openssl rand -hex 32) ───
SESSION_SECRET=$(openssl rand -hex 32)

# ─── Entra ID (operator authentication) ───
ENTRA_TENANT_ID=YOUR_TRILOGIAM_TENANT_ID
ENTRA_CLIENT_ID=YOUR_ENTRA_APP_CLIENT_ID
ENTRA_CLIENT_SECRET=YOUR_ENTRA_APP_CLIENT_SECRET
ENTRA_REDIRECT_URI=https://$SERVER_HOSTNAME/auth/callback

# ─── Operator role groups (Entra group object IDs) ───
ENTRA_AUTHORIZED_GROUP_ID=YOUR_ADMIN_GROUP_ID
ENTRA_ADMIN_GROUP_ID=YOUR_ADMIN_GROUP_ID
ENTRA_MEMBER_GROUP_ID=YOUR_MEMBER_GROUP_ID
ENTRA_VIEWER_GROUP_ID=YOUR_VIEWER_GROUP_ID

# ─── Graph cert (for app-only Microsoft Graph + EXO + Teams) ───
# Generated by panoptica-setup.sh in /opt/panoptica/certs/
# Upload .cer to Entra app registration → Certificates & secrets,
# then paste the resulting thumbprint here.
GRAPH_CERT_THUMBPRINT=YOUR_THUMBPRINT_FROM_SETUP_SCRIPT
GRAPH_CERT_PATH=/opt/panoptica/certs/panoptica-graph.pfx
ENV_TEMPLATE

chown -R "$REAL_USER:$REAL_USER" /opt/panoptica

echo -e "${GREEN}✓ /opt/panoptica scaffolding ready${NC}"
echo "  Dirs: src config locales public public/css public/js logs scripts backups certs sysconfig"
echo "  /opt/panoptica/.env.template written (with all current config keys)"

# ═══════════════════════════════════════════════════════════════
# STEP 10: Samba share for Mac SMB editing
# ═══════════════════════════════════════════════════════════════
step "Installing + configuring Samba"

apt install -y samba

# Set Samba password for the user (idempotent — overwrites)
(echo "$SAMBA_PASS"; echo "$SAMBA_PASS") | smbpasswd -s -a "$REAL_USER"

# Idempotent share config — remove any existing [panoptica] block
# before re-adding (the original script blindly appended, which
# duplicates on re-run).
if grep -q "^\[panoptica\]" /etc/samba/smb.conf; then
    # Strip the existing [panoptica] section (from the marker to next [section] or EOF)
    sed -i '/^\[panoptica\]/,/^\[/{/^\[panoptica\]/d; /^\[/!d}' /etc/samba/smb.conf
fi

cat >> /etc/samba/smb.conf <<SAMBA_CONF

[panoptica]
   path = /opt/panoptica
   browseable = yes
   writable = yes
   valid users = $REAL_USER
   create mask = 0664
   directory mask = 0775
   force user = $REAL_USER
   force group = $REAL_USER
SAMBA_CONF

systemctl restart smbd
systemctl enable smbd

echo -e "${GREEN}✓ Samba share 'panoptica' → /opt/panoptica${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 11: UFW firewall
# ═══════════════════════════════════════════════════════════════
step "Configuring UFW firewall (22, 80, 443, 445)"

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 445/tcp comment 'Samba'
ufw --force enable

echo -e "${GREEN}✓ Firewall enabled${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 12: Cert directory permissions
# ═══════════════════════════════════════════════════════════════
step "Locking down cert directory permissions"

mkdir -p "$CERT_DIR"
chown "$REAL_USER:$REAL_USER" "$CERT_DIR"
chmod 0700 "$CERT_DIR"

echo -e "${GREEN}✓ $CERT_DIR (owner=$REAL_USER, mode=0700)${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 13: Generate fresh Graph cert (always — per design choice)
# ═══════════════════════════════════════════════════════════════
step "Generating self-signed Graph cert (${CERT_KEY_BITS}-bit RSA, ${CERT_DAYS}d)"

PFX_PATH="$CERT_DIR/${CERT_NAME}.pfx"
CER_PATH="$CERT_DIR/${CERT_NAME}.cer"
KEY_PATH="$CERT_DIR/${CERT_NAME}.key"
CRT_PATH="$CERT_DIR/${CERT_NAME}.crt"
THUMB_PATH="$CERT_DIR/${CERT_NAME}.thumbprint"

if [ -f "$PFX_PATH" ]; then
    echo -e "${YELLOW}  ⚠ Existing cert at $PFX_PATH will be OVERWRITTEN.${NC}"
    OLD_THUMB=$(cat "$THUMB_PATH" 2>/dev/null || echo "(unknown)")
    echo -e "${YELLOW}  Old thumbprint (now invalid): $OLD_THUMB${NC}"
fi

# Generate RSA key + self-signed cert in one call.
# -nodes: no passphrase on private key (file perms protect it)
# -batch: no interactive prompts
openssl req -x509 -nodes \
    -days "$CERT_DAYS" \
    -newkey "rsa:$CERT_KEY_BITS" \
    -keyout "$KEY_PATH" \
    -out "$CRT_PATH" \
    -subj "$CERT_SUBJECT" \
    -batch 2>/dev/null

# PFX bundle (PKCS#12) — Azure app reg accepts this for upload too,
# but we'll upload .cer (DER) which is more idiomatic in the portal.
openssl pkcs12 -export \
    -out "$PFX_PATH" \
    -inkey "$KEY_PATH" \
    -in "$CRT_PATH" \
    -name "Panoptica365 Graph Service" \
    -passout pass: 2>/dev/null

# DER-encoded public half — this is what you upload to Entra.
openssl x509 -in "$CRT_PATH" -outform DER -out "$CER_PATH"

# SHA-1 thumbprint — Azure identifies certs by SHA-1 (identity, not signature)
THUMBPRINT=$(openssl x509 -in "$CRT_PATH" -noout -fingerprint -sha1 \
              | sed 's/SHA1 Fingerprint=//' | tr -d ':')
echo "$THUMBPRINT" > "$THUMB_PATH"

# Permissions
chown "$REAL_USER:$REAL_USER" "$PFX_PATH" "$CER_PATH" "$KEY_PATH" "$CRT_PATH" "$THUMB_PATH"
chmod 0600 "$PFX_PATH" "$KEY_PATH"
chmod 0644 "$CER_PATH" "$CRT_PATH" "$THUMB_PATH"

CERT_EXPIRY=$(openssl x509 -in "$CRT_PATH" -noout -enddate | sed 's/notAfter=//')

echo -e "${GREEN}✓ New cert generated${NC}"
echo -e "  Thumbprint: ${GREEN}$THUMBPRINT${NC}"
echo -e "  Expires:    ${GREEN}$CERT_EXPIRY${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 14: Smoke-test pwsh + cert load as service user
# ═══════════════════════════════════════════════════════════════
step "Smoke-testing pwsh + cert load"

sudo -u "$REAL_USER" pwsh -NoProfile -NonInteractive -Command "
    \$ErrorActionPreference = 'Stop'
    if (-not (Test-Path '$PFX_PATH')) { throw 'PFX not readable at $PFX_PATH' }
    \$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new('$PFX_PATH', '')
    Write-Host ('Cert subject:    ' + \$cert.Subject)
    Write-Host ('Cert thumbprint: ' + \$cert.Thumbprint)
    Write-Host ('Cert expires:    ' + \$cert.NotAfter.ToString('yyyy-MM-dd'))
    Import-Module ExchangeOnlineManagement -ErrorAction Stop
    Write-Host 'Module import: OK'
"

echo -e "${GREEN}✓ Smoke test passed${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 15: Python venv + ReportLab (PDF report generation)
# ═══════════════════════════════════════════════════════════════
# The Documentation and Security Posture reports are rendered by
# Python scripts under scripts/ that depend on ReportLab (and
# matplotlib, for the Security Posture report's charts). The app
# (src/routes/api-reports.js) looks for an interpreter at
# /opt/panoptica/venv/bin/python and only falls back to a bare
# `python3` — which on a stock Ubuntu box has no ReportLab — if that
# venv is absent. Provisioning it here is what makes PDF generation
# work on a host install (the Docker image already does the
# equivalent in its Dockerfile).
step "Creating Python venv + installing ReportLab"

python3 -m venv /opt/panoptica/venv
/opt/panoptica/venv/bin/pip install --quiet --upgrade pip

# scripts/requirements.txt only exists once the app code has been
# restored from backup (which happens AFTER this script). Use it when
# present; otherwise install the dependency directly so PDF generation
# works even on a first run before the code restore.
REQ_FILE=/opt/panoptica/scripts/requirements.txt
if [ -f "$REQ_FILE" ]; then
    /opt/panoptica/venv/bin/pip install --quiet -r "$REQ_FILE"
else
    /opt/panoptica/venv/bin/pip install --quiet 'reportlab>=4,<5' 'matplotlib>=3,<4'
fi

echo -e "${GREEN}✓ Python venv ready ($(/opt/panoptica/venv/bin/python --version 2>&1)) — ReportLab + matplotlib installed${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 16: Final ownership pass + .env preservation check
# ═══════════════════════════════════════════════════════════════
step "Final ownership pass"

# Make sure the whole tree is owned by the real user. If a backup
# restore was already done before running this script, this catches
# any root-owned files that snuck in via tar/rsync.
chown -R "$REAL_USER:$REAL_USER" /opt/panoptica
chmod 0700 "$CERT_DIR"

# Preservation check — if the user already has a live .env, we did NOT touch it.
if [ -f /opt/panoptica/.env ]; then
    echo -e "${BLUE}  /opt/panoptica/.env exists — left untouched.${NC}"
    echo -e "${YELLOW}  Don't forget to update GRAPH_CERT_THUMBPRINT in it!${NC}"
else
    echo -e "${BLUE}  No /opt/panoptica/.env yet — copy .env.template and fill in.${NC}"
fi

echo -e "${GREEN}✓ Ownership normalized to $REAL_USER${NC}"

# ═══════════════════════════════════════════════════════════════
# DONE — Summary
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}   SETUP COMPLETE${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}Versions installed:${NC}"
echo -e "  ${BLUE}OS:${NC}         $(. /etc/os-release; echo $PRETTY_NAME)"
echo -e "  ${BLUE}Timezone:${NC}   $(timedatectl show --property=Timezone --value)"
echo -e "  ${BLUE}Node.js:${NC}    $(sudo -u "$REAL_USER" bash -c 'export NVM_DIR="'"$REAL_HOME"'/.nvm"; . "$NVM_DIR/nvm.sh"; node --version')"
echo -e "  ${BLUE}npm:${NC}        $(sudo -u "$REAL_USER" bash -c 'export NVM_DIR="'"$REAL_HOME"'/.nvm"; . "$NVM_DIR/nvm.sh"; npm --version')"
echo -e "  ${BLUE}PM2:${NC}        $(sudo -u "$REAL_USER" bash -c 'export NVM_DIR="'"$REAL_HOME"'/.nvm"; . "$NVM_DIR/nvm.sh"; pm2 --version')"
echo -e "  ${BLUE}MySQL:${NC}      $(mysql --version | head -1)"
echo -e "  ${BLUE}Nginx:${NC}      $(nginx -v 2>&1)"
echo -e "  ${BLUE}PowerShell:${NC} $PWSH_VERSION"
echo ""
echo -e "${GREEN}Key paths:${NC}"
echo -e "  ${BLUE}Project:${NC}      /opt/panoptica"
echo -e "  ${BLUE}DB:${NC}           panoptica (user: panoptica)"
echo -e "  ${BLUE}TLS cert:${NC}     /etc/nginx/ssl/panoptica.{crt,key}"
echo -e "  ${BLUE}Nginx site:${NC}   /etc/nginx/sites-available/panoptica"
echo -e "  ${BLUE}Graph cert:${NC}   $PFX_PATH (thumbprint: $THUMBPRINT)"
echo -e "  ${BLUE}.cer to upload:${NC} $CER_PATH"
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}   NEXT STEPS — DR RESTORE PROCEDURE${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}1. Restore /opt/panoptica from your QNAP NAS backup:${NC}"
echo -e "     Mount NAS → rsync the latest snapshot to /opt/panoptica"
echo -e "     (this will preserve files NOT generated by this script:"
echo -e "      src/, locales/, public/, scripts/, package.json, etc.)"
echo -e "     ${RED}IMPORTANT:${NC} after restore, RE-RUN cert generation if your"
echo -e "     restored cert pre-dates this run, or update Entra to use the"
echo -e "     restored cert's thumbprint instead. Pick one — don't mix."
echo ""
echo -e "${YELLOW}2. Restore the database from your nightly mysqldump:${NC}"
echo -e "     mysql -u panoptica -p panoptica < /path/to/latest.sql"
echo ""
echo -e "${YELLOW}3. Install Node dependencies:${NC}"
echo -e "     cd /opt/panoptica && npm install"
echo ""
echo -e "${YELLOW}4. Update /opt/panoptica/.env:${NC}"
echo -e "   ${GREEN}GRAPH_CERT_THUMBPRINT=$THUMBPRINT${NC}"
echo -e "   ${GREEN}GRAPH_CERT_PATH=$PFX_PATH${NC}"
echo -e "   (everything else should match your old .env values from the backup)"
echo ""
echo -e "${YELLOW}5. Upload the new Graph cert to Entra:${NC}"
echo -e "     Entra admin centre → App registrations → Panoptica →"
echo -e "       Certificates & secrets → Certificates → Upload certificate"
echo -e "     File: ${GREEN}$CER_PATH${NC}"
echo -e "     ${BLUE}(Then DELETE the old cert from Entra.)${NC}"
echo ""
echo -e "${YELLOW}6. Re-create cron jobs (NOT in /opt/panoptica backup):${NC}"
echo -e "     Root crontab:"
echo -e "       ${GREEN}0 3 * * * /usr/local/sbin/panoptica_backup.sh >> /var/log/panoptica_backup.log 2>&1${NC}"
echo -e "     User crontab (as $REAL_USER):"
echo -e "       ${GREEN}0 2 * * * DB_PASS=\"...\" /opt/panoptica/scripts/mysql-backup.sh${NC}"
echo -e "     Plus restore /usr/local/sbin/panoptica_backup.sh and"
echo -e "     /etc/logrotate.d/panoptica_backup from your /sysconfig/ stash."
echo -e "     ${BLUE}See DR-RESTORE.md for the full sequence.${NC}"
echo ""
echo -e "${YELLOW}7. Start the app + persist with pm2:${NC}"
echo -e "     cd /opt/panoptica"
echo -e "     pm2 start src/server.js --name panoptica"
echo -e "     pm2 save"
echo ""
echo -e "${YELLOW}8. Network finalization:${NC}"
echo -e "     • Set static IP: Settings → Network → IPv4 → Manual"
echo -e "     • DNS A record: $SERVER_HOSTNAME → static IP"
echo -e "     • Mac SMB mount: Finder Cmd+K → smb://$SERVER_HOSTNAME/panoptica"
echo -e "       user: $REAL_USER, password: (the Samba password you just set)"
echo ""
echo -e "${GREEN}You're ready to restore.${NC}"
echo ""
