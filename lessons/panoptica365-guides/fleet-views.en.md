---
title: "Fleet views — Heatmap, Daily Activity and SharePoint"
subtitle: "The cross-tenant surfaces: posture as a grid, today's authentication weather, and sharing audits."
icon: "layout-grid"
last_updated: 2026-06-07
---

# Fleet views — Heatmap, Daily Activity and SharePoint

Per-tenant pages answer "how is this customer doing?". Three pages answer the MSP question: "how is the *fleet* doing, and where do I spend effort next?"

## Heatmap

**Heatmap** (sidebar) is every managed tenant × every monitored security control, as a grid of status dots.

At the top, the **fleet score** — the percentage of *applicable* controls that are compliant across managed tenants — with three stat cards: managed tenants, tenants with stale data, and active exemptions. "Applicable" matters: controls a tenant can't have (license-gated, not relevant) count as *Not available*, not as failures.

Two strips below are where the leverage is:

- **Movers — biggest 7-day changes.** Which tenants regressed (or improved) most this week. A tenant dropping five points is a conversation to have *now*.
- **Universally weak — campaign candidates.** Controls that are red or unconfigured at the most tenants. This is your remediation campaign list: one control, fixed everywhere, in one sweep. Click a row for the campaign slideout — affected tenants, the control's details, and deep links straight into each tenant's Security page.

The grid itself starts collapsed to categories; click a category header to expand into per-control columns. Dot legend: **Healthy** (green), **Drifted** (red), **Not set up** (yellow), **Not available on this tenant** (gray), **No data** (stale). Click any dot to deep-link to that tenant and control on the Security page.

## Daily Activity

**Daily Activity** (sidebar) is today's authentication weather: two donut charts, **Login Failures — Today** and **CA Blocks — Today**, segmented by tenant.

The useful part is the deviation math: each tenant's legend row shows today's count against its own 7-day rolling average — "avg 12/day" with a deviation percentage. Forty failures is Tuesday for a 200-seat tenant and a password spray for a 12-seat one; the baseline tells them apart. Click a legend row for the event detail: an AI assessment of the pattern, then the event table (time, user, application, IP, location, error, risk level), and click through any event for full sign-in detail.

This page is a *context* surface, not an alarm system — genuine attack patterns (spray, brute force, impossible travel) fire alerts on their own. Use Daily Activity when a briefing line or an alert makes you want to see the shape of today's traffic.

## SharePoint

**SharePoint** (sidebar) aggregates sharing-and-access audit events across tenants: anonymous link creation, external sharing events, site admin changes, malware detections in SharePoint/OneDrive, and sharing policy changes. It complements the per-tenant Overview cards (SharePoint Sites, Anonymous Links) with the event-level view — who created that anonymous link, on which site, when.

## How these fit your week

Alerts run your day; fleet views run your week. A reasonable rhythm: Heatmap once a week to pick a campaign (clear one universally-weak control fleet-wide), Movers to catch the regressing tenant, Daily Activity and SharePoint on demand when something makes you curious. All of it stays read-only — these pages tell you where to act; the acting happens in Security, CA, Intune, and the customer conversation.
