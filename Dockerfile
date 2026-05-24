# syntax=docker/dockerfile:1.7
#
# Panoptica365 — Application Container
#
# Single-stage Debian-based image. Carries:
#   - Node.js 24 LTS              (the app)
#   - PowerShell 7.x              (EXO + SharePoint + Teams cmdlets)
#   - .NET 8 runtime              (pulled in by pwsh; some modules need it)
#   - Python 3.11 + ReportLab     (PDF report generation)
#   - Microsoft pwsh modules      (ExchangeOnlineManagement,
#                                  Microsoft.Online.SharePoint.PowerShell,
#                                  MicrosoftTeams)
#
# Build-time decision: pwsh modules are installed during `docker build`
# rather than on first container boot. Trade-off: ~2 GB image vs ~500 MB.
# Justification: predictable boot speed (no PSGallery download on first
# start), no internet dependency on first run, module versions pinned to
# the image build. Per Stage 2 decision 2026-05-18.
#
# Multi-stage NOT used — savings would be marginal (~200 MB on a 2 GB
# image) and clarity matters more for a Stage 2 first cut. Revisit if
# image size becomes an operational concern.
#
# Base: debian:bookworm-slim — Microsoft's apt repo packages target
# this distro family. Alpine is NOT viable: pwsh + .NET have known
# glibc-vs-musl issues that would burn cycles to work around.

FROM debian:bookworm-slim

# ─── Build args ─────────────────────────────────────────────────────
ARG NODE_MAJOR=24
ARG TARGETARCH

# Prevent apt prompts during build
ENV DEBIAN_FRONTEND=noninteractive

# ─── 1. OS essentials ───────────────────────────────────────────────
# - ca-certificates / curl / gnupg: needed to add third-party apt repos
# - jq / unzip / git: runtime utilities the app and its pwsh scripts use
# - netcat-openbsd: entrypoint.sh uses `nc -z` to wait for MySQL
# - python3 + venv + pip: ReportLab for PDF generation
# - build-essential: some npm modules compile native bindings
# - tzdata: lets the TZ env var actually take effect inside the container
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
        jq \
        unzip \
        git \
        netcat-openbsd \
        python3 \
        python3-venv \
        python3-pip \
        build-essential \
        tzdata \
    && rm -rf /var/lib/apt/lists/*

# ─── 2. Node.js (NodeSource) ────────────────────────────────────────
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node --version \
    && npm --version

# ─── 3. PowerShell 7 + .NET 8 (Microsoft apt repo) ──────────────────
# Microsoft's bookworm repo ships pwsh-lts which pulls .NET 8 as a dep.
RUN curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
        | gpg --dearmor -o /usr/share/keyrings/microsoft.gpg \
    && echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" \
        > /etc/apt/sources.list.d/microsoft-prod.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends powershell \
    && rm -rf /var/lib/apt/lists/* \
    && pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'

# ─── 4. PowerShell modules — installed at build time ────────────────
# Scope=AllUsers so the modules live under /usr/local/share/powershell
# and are visible to whatever user the container runs as.
# AllowClobber + Force handle the rare case where a module's cmdlets
# overlap with another module already present.
RUN pwsh -NoProfile -NonInteractive -Command "\
        \$ErrorActionPreference = 'Stop'; \
        Set-PSRepository -Name PSGallery -InstallationPolicy Trusted; \
        Write-Host '[Modules] Installing ExchangeOnlineManagement...'; \
        Install-Module -Name ExchangeOnlineManagement -Scope AllUsers -Force -AllowClobber; \
        Write-Host '[Modules] Installing Microsoft.Online.SharePoint.PowerShell...'; \
        Install-Module -Name Microsoft.Online.SharePoint.PowerShell -Scope AllUsers -Force -AllowClobber; \
        Write-Host '[Modules] Installing MicrosoftTeams...'; \
        Install-Module -Name MicrosoftTeams -Scope AllUsers -Force -AllowClobber; \
        Write-Host '[Modules] Verifying imports...'; \
        Import-Module ExchangeOnlineManagement -ErrorAction Stop; \
        Import-Module Microsoft.Online.SharePoint.PowerShell -ErrorAction Stop; \
        Import-Module MicrosoftTeams -ErrorAction Stop; \
        Get-Module | Where-Object { \$_.Name -in 'ExchangeOnlineManagement','Microsoft.Online.SharePoint.PowerShell','MicrosoftTeams' } | Format-Table Name,Version"

# ─── 5. Application directory ───────────────────────────────────────
WORKDIR /app

# ─── 6. Python venv for ReportLab (PDF generation) ──────────────────
# Created at /app/venv so the existing fallback in
# src/routes/api-reports.js (path.join(projectRoot, 'venv', 'bin', 'python'))
# finds it without any code change. Dependency list is shared with the
# host installer (panoptica-setup.sh) via scripts/requirements.txt so the
# two install paths can't drift. Copied on its own first to keep this
# layer cached as long as the requirements don't change.
COPY scripts/requirements.txt ./scripts/requirements.txt
RUN python3 -m venv /app/venv \
    && /app/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /app/venv/bin/pip install --no-cache-dir -r scripts/requirements.txt

# ─── 7. npm dependencies ────────────────────────────────────────────
# package.json + package-lock.json copied first to maximize layer cache
# reuse: as long as deps don't change, this layer survives across rebuilds.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

# ─── 8. Application source ──────────────────────────────────────────
# .dockerignore filters out dev/, Documentation/, node_modules/, .env,
# certs/, data/, etc. — only the actual app code lands in the image.
COPY . .

# ─── 9. Entrypoint ──────────────────────────────────────────────────
# Waits for MySQL to be reachable, runs schema migrations (idempotent),
# then execs into `node src/server.js`. The script lives in the repo at
# scripts/entrypoint.sh so operators can inspect / customize it.
RUN chmod +x /app/scripts/entrypoint.sh

# ─── 10. Container metadata ─────────────────────────────────────────
# Default port the app listens on (Caddy proxies to this).
EXPOSE 3000

# Healthcheck — used by docker compose's depends_on: service_healthy
# so the proxy / updater containers don't try to reach the app until
# it's actually ready to serve requests. /healthz is the lightweight
# endpoint added in Stage 2 push #1; no auth, no DB call.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=60s \
    CMD curl -fsS http://localhost:3000/healthz || exit 1

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
