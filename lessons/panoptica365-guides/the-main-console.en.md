---
title: "The Main Console — your fleet at a glance"
subtitle: "Secure Score gauges, the tenant list, and the daily briefing: the page you land on and what to do from it."
icon: "layout-dashboard"
last_updated: 2026-06-07
---

# The Main Console — your fleet at a glance

The **Main Console** is the landing page. It answers one question: *how is the fleet doing, and which tenant needs me?*

## Secure Score & Alert Overview

The top panel shows three gauges built from Microsoft Secure Score across your managed tenants:

- **Average** — the fleet-wide average score.
- **Highest** — your best tenant.
- **Lowest** — the tenant that needs attention first.

Secure Score is Microsoft's own measure of a tenant's security posture (the *Secure Score* card in Learn explains how it's calculated and what it's worth). As a fleet operator, the trend and the spread matter more than any single number.

## The tenant list

Below the gauges sits the tenant list, with a filter box (*Filter tenants…*) for when the fleet grows. Each row shows:

- **Tenant** — the display name.
- **Secure Score** — a percentage badge, color-coded: green at 70% and above, yellow at 45–69%, red below 45%.
- **Status** — *Active*, or *Error* if the last poll failed.
- **Last Polled** — when data was last collected.

**Click any tenant row to open its dashboard.** That's the main navigation gesture in Panoptica365 — the per-tenant dashboard is where investigation happens, and the next guide tours it.

## The daily briefing

The console also surfaces Claude's daily summary — a short, plain-language digest of what happened across the fleet in the last day: notable alerts, patterns worth a look, and anything Microsoft announced that affects settings you monitor. The same briefing is emailed at 6 AM to your configured recipients (see *Configure notifications* for the severity threshold and recipients).

## What "good" looks like

On a healthy morning, you glance at the console: gauges steady, all tenants *Active*, briefing has nothing alarming — and you move on with your day. Panoptica365 is alert-driven: if something needs you, it will arrive as an alert (email, PSA ticket, or in the **Alerts** page) rather than waiting for you to find it here.
