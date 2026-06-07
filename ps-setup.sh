#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# PANOPTICA — PowerShell Core Setup Script
# Prerequisite for Phase A2 / Phase B of the Security Settings Engine
#
# What this script installs and configures:
#   - PowerShell 7.4 LTS (via Microsoft's apt repository)
#   - ExchangeOnlineManagement module
#   - Microsoft.Online.SharePoint.PowerShell module
#   - MicrosoftTeams module
#   - A 2-year self-signed certificate for app-only authentication
#     (generated with openssl, stored at /opt/panoptica/certs/)
#
# What it does NOT do (these are manual steps, listed at the end):
#   - Upload the .cer to the Panoptica app registration in Entra ID
#   - Grant the Panoptica service principal the Exchange Administrator
#     role in each customer tenant
#   - Update .env with the certificate thumbprint (printed, you paste)
#
# Usage:
#   chmod +x ps-setup.sh
#   sudo ./ps-setup.sh
#
# Idempotent. Running twice is safe; the cert step will warn before
# overwriting an existing certificate.
#
# Trilogiam Technologies — April 2026
# ═══════════════════════════════════════════════════════════════════

set -e

# ─── Colors for output ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ─── Must be run as root ───
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}ERROR: This script must be run with sudo.${NC}"
    echo "Usage: sudo ./ps-setup.sh"
    exit 1
fi

# ─── Identify the real user (not root) ───
REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME=$(eval echo "~$REAL_USER")

if [ "$REAL_USER" = "root" ]; then
    echo -e "${RED}ERROR: Don't run this as the root user directly.${NC}"
    echo "Run it as your normal user with sudo: sudo ./ps-setup.sh"
    exit 1
fi

# ─── Defaults ───
CERT_DIR="/opt/panoptica/certs"
CERT_NAME="panoptica-graph"
CERT_DAYS=730            # 2 years
CERT_KEY_BITS=4096
CERT_SUBJECT="/CN=Panoptica365 Graph Service/O=Panoptica365"

# ─── Banner ───
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}   PANOPTICA — PowerShell Core Setup${NC}"
echo -e "${CYAN}   Phase A2 / Phase B prerequisite${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Running as user: ${GREEN}$REAL_USER${NC}"
echo -e "  Cert directory:  ${GREEN}$CERT_DIR${NC}"
echo -e "  Cert name:       ${GREEN}$CERT_NAME${NC} (valid ${CERT_DAYS} days)"
echo ""

# ─── Confirmation ───
echo -e "${YELLOW}Ready to install. This will take 3-5 minutes.${NC}"
echo ""
read -p "$(echo -e ${YELLOW})Press Enter to start, or Ctrl+C to cancel... $(echo -e ${NC})"
echo ""

# ─── Step tracker ───
STEP=0
TOTAL_STEPS=6
step() {
    STEP=$((STEP + 1))
    echo ""
    echo -e "${CYAN}[$STEP/$TOTAL_STEPS] $1${NC}"
    echo -e "${CYAN}$(printf '─%.0s' {1..60})${NC}"
}

# ═══════════════════════════════════════════════════════════════
# STEP 1: Detect Ubuntu version and add Microsoft apt repository
# ═══════════════════════════════════════════════════════════════
step "Adding Microsoft's apt repository for PowerShell"

. /etc/os-release
UBUNTU_VERSION="$VERSION_ID"
UBUNTU_CODENAME="$VERSION_CODENAME"

if [ "$ID" != "ubuntu" ]; then
    echo -e "${RED}ERROR: This script is tested on Ubuntu only.${NC}"
    echo "Detected: $PRETTY_NAME"
    exit 1
fi

# Microsoft publishes per-Ubuntu-release repos. Map 24.04→noble, 22.04→jammy.
case "$UBUNTU_CODENAME" in
    noble|jammy|focal)
        MS_REPO_SUFFIX="$UBUNTU_VERSION"
        ;;
    *)
        echo -e "${YELLOW}WARNING: Ubuntu $UBUNTU_CODENAME is not a known LTS.${NC}"
        echo "Falling back to the 24.04 (noble) repository — this may not work."
        MS_REPO_SUFFIX="24.04"
        ;;
esac

# Install prerequisites for apt-over-HTTPS and GPG key handling
apt update
apt install -y curl gnupg ca-certificates apt-transport-https

# Import Microsoft's signing key (idempotent — overwrite is fine)
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
    | gpg --dearmor --yes -o /usr/share/keyrings/microsoft.gpg

# Add the repository, pinned by signed-by to the key we just imported.
cat > /etc/apt/sources.list.d/microsoft-powershell.list <<REPO_CONF
deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/ubuntu/${MS_REPO_SUFFIX}/prod ${UBUNTU_CODENAME} main
REPO_CONF

apt update

echo -e "${GREEN}✓ Microsoft repository added for Ubuntu $UBUNTU_VERSION ($UBUNTU_CODENAME)${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 2: Install PowerShell 7.x LTS
# ═══════════════════════════════════════════════════════════════
step "Installing PowerShell Core"

if command -v pwsh >/dev/null 2>&1; then
    CURRENT_PWSH=$(pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()' 2>/dev/null || echo "unknown")
    echo -e "${BLUE}  PowerShell is already installed: $CURRENT_PWSH${NC}"
    echo -e "${BLUE}  Running apt upgrade to ensure latest patch level...${NC}"
fi

apt install -y powershell

PWSH_VERSION=$(pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()')
echo -e "${GREEN}✓ PowerShell $PWSH_VERSION installed${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 3: Install the three PowerShell modules as the service user
# ═══════════════════════════════════════════════════════════════
step "Installing ExchangeOnlineManagement, SharePoint, Teams modules"

# Modules MUST be installed as the user that will run pwsh at runtime,
# with Scope=CurrentUser. Installing as root + CurrentUser would put the
# modules in /root/.local/share/powershell/Modules — pwsh running as
# the service user would not find them. Install as REAL_USER, -Force
# re-installs if a newer version is available.
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

# Verify all three loaded modules are importable
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
# STEP 4: Create the cert directory with tight permissions
# ═══════════════════════════════════════════════════════════════
step "Preparing certificate directory"

mkdir -p "$CERT_DIR"
chown "$REAL_USER:$REAL_USER" "$CERT_DIR"
chmod 0700 "$CERT_DIR"

echo -e "${GREEN}✓ $CERT_DIR created (owner=$REAL_USER, mode=0700)${NC}"

# ═══════════════════════════════════════════════════════════════
# STEP 5: Generate the self-signed certificate
# ═══════════════════════════════════════════════════════════════
step "Generating self-signed certificate (${CERT_KEY_BITS}-bit RSA, ${CERT_DAYS} days)"

PFX_PATH="$CERT_DIR/${CERT_NAME}.pfx"
CER_PATH="$CERT_DIR/${CERT_NAME}.cer"
KEY_PATH="$CERT_DIR/${CERT_NAME}.key"
CRT_PATH="$CERT_DIR/${CERT_NAME}.crt"
THUMB_PATH="$CERT_DIR/${CERT_NAME}.thumbprint"

# Refuse to silently overwrite an existing certificate — rotation is
# destructive (anyone signing with the old private key still validates).
# Require an explicit --force or interactive confirmation.
if [ -f "$PFX_PATH" ]; then
    echo -e "${YELLOW}  An existing certificate is already at $PFX_PATH.${NC}"
    read -p "$(echo -e ${YELLOW})Overwrite and generate a new certificate? (yes/NO): $(echo -e ${NC})" OVERWRITE_CONFIRM
    if [ "$OVERWRITE_CONFIRM" != "yes" ]; then
        echo -e "${BLUE}  Keeping existing certificate. Skipping generation.${NC}"
        EXISTING_THUMB=$(cat "$THUMB_PATH" 2>/dev/null || echo "(thumbprint file missing — regenerate)")
        echo -e "${BLUE}  Existing thumbprint: $EXISTING_THUMB${NC}"
    else
        GENERATE_CERT=1
    fi
else
    GENERATE_CERT=1
fi

if [ "${GENERATE_CERT:-0}" = "1" ]; then
    # Generate RSA private key + self-signed cert in one openssl call.
    # -nodes = no passphrase on the private key (file perms are the
    # protection; adding a passphrase here means stashing it in .env,
    # which defeats the purpose). -batch suppresses interactive prompts.
    openssl req -x509 -nodes \
        -days "$CERT_DAYS" \
        -newkey "rsa:$CERT_KEY_BITS" \
        -keyout "$KEY_PATH" \
        -out "$CRT_PATH" \
        -subj "$CERT_SUBJECT" \
        -batch 2>/dev/null

    # Bundle into PFX (PKCS#12) — passphrase empty. pwsh/Node can consume
    # either the PFX or the crt+key pair; PFX is the idiomatic one for
    # Azure app registrations so we ship both.
    openssl pkcs12 -export \
        -out "$PFX_PATH" \
        -inkey "$KEY_PATH" \
        -in "$CRT_PATH" \
        -name "Panoptica365 Graph Service" \
        -passout pass: 2>/dev/null

    # The .cer is the DER-encoded public half. Azure app registration
    # accepts either DER (.cer) or PEM (.crt); DER is the more common
    # extension in the Azure portal upload dialog.
    openssl x509 -in "$CRT_PATH" -outform DER -out "$CER_PATH"

    # Compute the SHA-1 thumbprint — Azure and pwsh identify certificates
    # by SHA-1 thumbprint. (Yes, SHA-1 is cryptographically weak; this is
    # identity-only, not a signature, so it's fine for this purpose.)
    THUMBPRINT=$(openssl x509 -in "$CRT_PATH" -noout -fingerprint -sha1 \
                  | sed 's/SHA1 Fingerprint=//' | tr -d ':')
    echo "$THUMBPRINT" > "$THUMB_PATH"

    # Lock down permissions
    chown "$REAL_USER:$REAL_USER" "$PFX_PATH" "$CER_PATH" "$KEY_PATH" "$CRT_PATH" "$THUMB_PATH"
    chmod 0600 "$PFX_PATH" "$KEY_PATH"
    chmod 0644 "$CER_PATH" "$CRT_PATH" "$THUMB_PATH"

    # Compute expiry for the summary
    CERT_EXPIRY=$(openssl x509 -in "$CRT_PATH" -noout -enddate | sed 's/notAfter=//')

    echo -e "${GREEN}✓ Certificate generated${NC}"
    echo -e "  Thumbprint: ${GREEN}$THUMBPRINT${NC}"
    echo -e "  Expires:    ${GREEN}$CERT_EXPIRY${NC}"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 6: Sanity check — try a pwsh dry-run
# ═══════════════════════════════════════════════════════════════
step "Smoke-testing pwsh + module load as service user"

# Just verifies the pwsh binary runs, the modules load, and the cert file
# is readable to the service user. Does NOT attempt a real Graph auth —
# that requires the .cer to be uploaded to the app registration first.
sudo -u "$REAL_USER" pwsh -NoProfile -NonInteractive -Command "
    \$ErrorActionPreference = 'Stop'
    if (-not (Test-Path '$PFX_PATH')) { throw 'PFX not readable at $PFX_PATH' }
    \$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new('$PFX_PATH', '')
    Write-Host ('Cert subject: ' + \$cert.Subject)
    Write-Host ('Cert thumbprint: ' + \$cert.Thumbprint)
    Write-Host ('Cert expires: ' + \$cert.NotAfter.ToString('yyyy-MM-dd'))
    Import-Module ExchangeOnlineManagement -ErrorAction Stop
    Write-Host 'Module import OK'
"

echo -e "${GREEN}✓ Smoke test passed${NC}"

# ═══════════════════════════════════════════════════════════════
# DONE — Summary + next steps (the manual bits)
# ═══════════════════════════════════════════════════════════════

FINAL_THUMB=$(cat "$THUMB_PATH")

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}   POWERSHELL SETUP COMPLETE${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}Installed:${NC}"
echo -e "  ${BLUE}PowerShell:${NC}  $PWSH_VERSION"
echo -e "  ${BLUE}Modules:${NC}     ExchangeOnlineManagement, SharePoint, Teams"
echo -e "  ${BLUE}Cert PFX:${NC}    $PFX_PATH (0600, $REAL_USER)"
echo -e "  ${BLUE}Cert CER:${NC}    $CER_PATH (for app-registration upload)"
echo -e "  ${BLUE}Thumbprint:${NC}  $FINAL_THUMB"
echo ""
echo -e "${YELLOW}═══ MANUAL STEPS REMAINING ═══${NC}"
echo ""
echo -e "${YELLOW}1. Upload the certificate to the Panoptica app registration.${NC}"
echo -e "   Go to: Entra admin centre → App registrations → Panoptica →"
echo -e "          Certificates & secrets → Certificates → Upload certificate"
echo -e "   Upload file: ${GREEN}$CER_PATH${NC}"
echo -e ""
echo -e "   Copy this thumbprint to your .env:"
echo -e "     ${GREEN}GRAPH_CERT_THUMBPRINT=$FINAL_THUMB${NC}"
echo -e "     ${GREEN}GRAPH_CERT_PATH=$PFX_PATH${NC}"
echo ""
echo -e "${YELLOW}2. Add the Exchange.ManageAsApp application permission.${NC}"
echo -e "   Same app registration → API permissions → Add a permission →"
echo -e "   Office 365 Exchange Online → Application permissions →"
echo -e "   check ${GREEN}Exchange.ManageAsApp${NC} → Add."
echo -e "   Then click ${GREEN}Grant admin consent for Trilogiam${NC}."
echo ""
echo -e "${YELLOW}3. In EACH customer tenant: grant the Panoptica service${NC}"
echo -e "${YELLOW}   principal the Exchange Administrator role.${NC}"
echo -e "   This cannot be automated from here — the customer tenant's own"
echo -e "   Global Admin has to do it. One-off step per tenant onboard."
echo -e "   Runbook to share with the customer admin is at:"
echo -e "   ${GREEN}dev/Panoptica/runbooks/exchange-admin-role.md${NC}"
echo -e "   (TODO: write this runbook as a Phase A2 deliverable.)"
echo ""
echo -e "${YELLOW}4. Recycle the Panoptica Node service so it picks up the${NC}"
echo -e "${YELLOW}   new .env values (once you've added them):${NC}"
echo -e "   ${GREEN}pm2 restart panoptica${NC}"
echo ""
echo -e "${BLUE}Note: certificate expires in ${CERT_DAYS} days. Set a calendar${NC}"
echo -e "${BLUE}reminder 60 days before expiry — rotation means regenerating${NC}"
echo -e "${BLUE}the cert, uploading the new one, and recycling the service.${NC}"
echo ""
