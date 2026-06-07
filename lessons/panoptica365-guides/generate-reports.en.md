---
title: "Generate reports"
subtitle: "Four report types and when to use each: posture for the QBR, documentation for the binder, quick assessment for the prospect."
icon: "file-text"
last_updated: 2026-06-07
---

# Generate reports

Monitoring earns its keep quietly; reports are where the customer *sees* the work. **Reports** (sidebar) generates branded PDF deliverables from the data Panoptica365 already holds — no screenshot-and-paste.

## The four types

**Security Posture Report (PDF).** The flagship customer deliverable: Secure Score and trends, Conditional Access coverage, alert activity over the selected period, charts, and an AI-written analysis of the tenant's posture. Takes a **time range** — last 7, 30, or 90 days. This is your QBR document.

**Configuration Documentation (PDF).** A point-in-time snapshot of the tenant's configuration, organized like the dashboard: identity, access policies, devices, email, collaboration. No time range — it documents *now*. This is the binder document: onboarding records, audit and insurance evidence, offboarding handovers. When a previous snapshot exists it's loaded for comparison.

**Quick Assessment (PDF).** Built for the audit-only / prospect scenario: a concise, findings-first assessment of a tenant's current state. Before generating, an optional **context box** lets you tell the AI what kind of organization this is — *"e.g. 40-person accounting firm"* — which sharpens the recommendations considerably. Fill it in; two sentences of context noticeably improve the output. Pairs naturally with audit-only tenants and their 14-day window.

**Tenant Snapshot (ZIP).** The raw data export — for archival, your own tooling, or handing the data itself over.

## Generating

1. Pick the **tenant**.
2. Pick the **report type**.
3. Pick the **time range** (Security Posture only — the others are point-in-time and the selector disables itself).
4. Click **Generate Report**.

A progress modal walks the stages — gathering data, fetching CA policies, rendering charts, AI analysis, assembling — typically a minute or two depending on type. Finished reports land in the **history list** below with a download button. The history is per-session: download what you generate; regeneration is cheap anyway.

## Branding and language

Reports carry your branding — company name and logo on the cover and footers — configured once by an Admin in **Settings → Report Branding** (transparent PNG, max 2 MB). Do this before the first customer-facing report goes out.

Reports are generated in the **tenant's language** (the Language field on the tenant), in all three locales — set a French-speaking customer's tenant to *fr* once, and every deliverable comes out in French.

## Choosing, in practice

- Prospect, pre-sales: **Quick Assessment** (with context filled in).
- New customer, end of onboarding: **Configuration Documentation** — the "before" picture.
- Quarterly review: **Security Posture**, 90 days.
- Insurance questionnaire or audit: **Configuration Documentation**, generated that day.
- Offboarding: **Configuration Documentation** + **Tenant Snapshot**, then archive.

The quiet win: a documented-configuration deliverable per customer per quarter used to be hours of manual screenshotting. Here it's a dropdown and a minute of progress bar — so actually do it quarterly.
