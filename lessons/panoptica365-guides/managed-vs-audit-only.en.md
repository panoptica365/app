---
title: "Managed vs audit-only tenants"
subtitle: "The one decision you make before consenting: full monitoring forever, or a read-only snapshot that expires."
icon: "scale"
last_updated: 2026-06-07
---

# Managed vs audit-only tenants

When you add a tenant, the very first choice — before any consent is granted — is its mode. Get this right up front, because the conversion only works in one direction.

## Managed

**Managed** is the normal mode for a paying customer. It gives you the full Panoptica365 feature set:

- Scheduled polling on the interval you choose.
- Alerts, drift detection, and AI analysis.
- The ability to **push** CA policies, Intune policies, and security settings to the tenant.
- Inclusion in fleet views (Heatmap, Daily Activity) and the daily briefing.

A managed tenant persists indefinitely — until an Admin deletes it.

## Audit-only

**Audit-only** is built for vulnerability assessments and prospect discovery. Think of it as a time-boxed photograph of a tenant you don't (yet) manage:

- **Read-only snapshot collection for export.** Panoptica365 reads the tenant's configuration so you can review it and generate reports.
- **No alerts, no drift detection, no writes** to the customer tenant. Nothing is pushed, nothing fires at 2 AM.
- **Automatic expiry.** The tenant is scheduled to expire **14 days after creation**, with hard-delete firing **7 days after that**. The Tenants table shows a countdown badge (e.g. *AUDIT · 9d left*), and the edit modal shows the exact expiry date.

This expiry is deliberate: you should not be holding a prospect's configuration data indefinitely without an engagement.

## Converting between modes

- **Audit-only → Managed: allowed.** The typical story — you ran an assessment, the prospect signed, now you manage them. An Admin opens the tenant's edit modal and switches **Mode** to Managed. The expiry is removed and full monitoring begins.
- **Managed → Audit-only: not allowed.** This is a one-way door. A managed tenant has alert history, deployed templates, baselines and change history that don't make sense in a read-only, expiring container.

## Practical guidance

- Prospect asked for a security assessment? **Audit-only.** Run it, generate a Quick Assessment or Documentation report, and let the data age out (or convert if they sign).
- New customer under contract? **Managed**, from day one.
- Not sure? **Audit-only** — you can always upgrade. The reverse requires deleting the tenant and re-onboarding.

One more note: deleting a tenant (any mode) permanently removes **all** of its data — alerts, snapshots, security settings, CA assignments, audits and change history. The confirmation modal means it.
