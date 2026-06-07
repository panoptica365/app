---
title: "System administration"
subtitle: "The rest of Settings and the system surfaces: Message Center feed, branding, licensing, diagnostics, health, updates, and the audit log."
icon: "wrench"
last_updated: 2026-06-07
---

# System administration

The closing guide: everything an Admin touches occasionally rather than daily. All of it lives in **Settings** and the **System** section of the sidebar.

## Microsoft message feed

Microsoft announces platform changes in the Message Center — including changes that will alter settings you monitor. **Settings → Microsoft message feed** lets you pick **one source tenant** whose Message Center Panoptica365 reads daily. Claude filters the feed for items relevant to monitored settings, and relevant items arrive as **one MSP-wide alert** (not per-tenant spam). Pick your own MSP tenant or your most representative customer tenant as the source; the feed contents are the same Microsoft-wide.

## Report branding

**Settings → Report Branding** — your company name (*"Prepared by ___"* on covers and footers) and logo (transparent PNG, max 2 MB, auto-resized). Set once, before the first customer deliverable.

## Claude API key

**Settings → Anthropic API Key** — the key behind all AI features (alert analysis, briefings, triage, report narratives). Rotation is painless: paste the new key, **Test Key**, then **Save** — the running process picks it up immediately, no restart.

## Licensing

**Settings → Licensing** — read-only view of your licensed seats, current usage across monitored tenants, tier and expiry, with a **Refresh now** button. If you're over seats, it says so plainly; contact your provider to add seats.

## Diagnostics and disk

**Diagnostics** captures a support bundle — logs, configuration summaries, database health — for troubleshooting with support. Bundles are **redacted**: no secrets, passwords or credentials. Capture, download, attach to your support email.

**Disk space** shows server storage with warnings at 80% and a red state at 90% — at those levels a banner also appears at the top of the app. Don't ignore it; a full disk takes the monitoring down with it.

## Health indicator

The colored health dot in the header is the platform's own status: **Healthy**, **Degraded**, or **Broken**. Click it for the System Health modal — per-component checks, so "Degraded" becomes "which subsystem, exactly". If alerts seem suspiciously quiet, this is the first click. *All Systems Nominal* is the answer you want.

## Updates and What's New

After an update, a toast announces the new version and the **What's New in Panoptica365** modal summarizes what changed — in your language. Takes thirty seconds and regularly surfaces features that would otherwise go unnoticed (these guides arrived through one of those, in fact).

## The Audit Log

**Audit Log** (sidebar → System, Admin) is the accountability record, in two views:

- **MSP Audit** — operator actions on the platform itself: logins, template CRUD, settings changes, role denials (403s), tenant lifecycle, exports. Filter by category, actor, description, date range, and outcome; summary cards show 30-day volume and failures.
- **Unified Timeline** — MSP audit events interleaved with per-tenant change events (automatic deployments and manually logged changes) in one stream. This is the "what happened around 3 PM Tuesday" view that joins *who did what in Panoptica365* with *what changed in the tenants*.

Click any row for full detail: actor, IP, session, target, metadata.

---

That's the full tour. From here, the rest of Learn covers the *security* knowledge behind the platform — Conditional Access design, Intune baselines, email security, Secure Score, and the attack patterns your alerts are watching for. Add tenants, deploy your baselines, tune the alerts — then let the platform do the patrolling.
