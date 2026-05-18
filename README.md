# Panoptica365

> Multi-tenant Microsoft 365 monitoring platform for managed service providers.

Panoptica365 ingests signals from across the Microsoft 365 ecosystem — Entra ID, Exchange Online, SharePoint, Teams, Defender XDR, Intune, and the Unified Audit Log — and surfaces what matters: security drift, configuration changes, threat activity, license risks, and overall tenant posture. Self-hosted on the MSP's infrastructure; one install monitors many customer tenants.

## Capabilities

- **Real-time alerting** across 45 alert types covering risky sign-ins, malware delivery, external sharing anomalies, suspicious admin activity, configuration drift, license expiry, and more.
- **AI-powered analysis** via Anthropic Claude — Haiku for per-alert reasoning, Sonnet for tenant digests, Opus for deep reports. Every alert ships with contextual interpretation rather than raw event data.
- **Security Settings drift detection** across 17 monitored settings, with auto-attribution of changes to operator actions via Microsoft Graph audit-log correlation.
- **Daily morning briefings** with severity thresholds and exemption-rule awareness.
- **Tenant posture reports** and **configuration documentation reports** (PDF, multi-language).
- **3-tier RBAC** (Admin / Member / Viewer) via Entra ID group membership.
- **Full localization** in English, French, and Spanish — UI text, AI-generated narrative, and operator notifications.
- **Per-tenant exemption rules** with operator-acknowledged expiry to suppress known false positives without losing audit trail.
- **Unified audit log** combining MSP operator actions, tenant-side configuration changes, and platform-detected drift events into a single timeline.

## Architecture

- **Runtime:** Node.js 24, PowerShell 7, .NET 8 (required by the Microsoft Graph SDK and several pwsh modules)
- **Database:** MySQL 8.4, multi-tenant via row-level scoping
- **Frontend:** vanilla JavaScript SPA with HTML partials (no React / Vue / Angular)
- **Reverse proxy:** Caddy 2 with auto-managed Let's Encrypt TLS
- **AI:** Anthropic Claude — Haiku, Sonnet, and Opus tiers for different cost / quality trade-offs
- **Microsoft integration:** Graph API (app-only via certificate), Exchange Online Management, SharePoint Online Management Shell, Microsoft Teams (delegated where Microsoft's GDAP model requires it)

## Status

Production for the originating MSP since early 2026. The platform is feature-stable: 45 alert evaluators, the Security Settings engine (Phases A + B), RBAC enforcement, full localization, AI analysis, daily reporting, and the unified audit log are live and validated against real customer tenants.

The commercial distribution pipeline — Docker images, GHCR publishing, one-command installer, in-app updater — is in active development.

## Installation

Current install path for a fresh Ubuntu 24.04 LTS host:

```bash
git clone git@github.com:panoptica365/app.git /opt/panoptica
cd /opt/panoptica
sudo ./panoptica-setup.sh
```

The setup script installs Node.js, PowerShell 7, MySQL 8, Caddy, the required Microsoft modules; configures the database, certificates, process management, firewall, and reverse proxy. Configuration keys are documented in `.env.template`. Disaster-recovery procedure is in `DR-RESTORE.md`.

The Docker-based install (`docker compose up`) is in development as part of the commercial release pipeline.

## License

Proprietary. © 2026 Panoptica365. All rights reserved.

This source is licensed to authorized partners under a separate commercial agreement. No part of it may be copied, modified, redistributed, or used to provide services to third parties without written permission.

## Contact

`jacques@panoptica365.com`
