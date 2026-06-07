---
title: "Add your first tenant"
subtitle: "The admin consent flow from start to finish: which account to use, what gets granted, and what happens next."
icon: "building-2"
last_updated: 2026-06-07
---

# Add your first tenant

Everything in Panoptica365 starts with onboarding a tenant. The flow takes about two minutes of clicking plus a few minutes of background data collection.

## Before you start

You need two things:

- The **Admin** role in Panoptica365 (the **Add Tenant** button is admin-only).
- Credentials that can grant admin consent **on the customer tenant** — either a **Global Administrator account in that tenant**, or an account with a **GDAP relationship** that includes sufficient rights to consent on its behalf. The key point: when Microsoft asks you to sign in, use the credentials that have access to the *target* tenant — not your own MSP tenant, unless that's the one you're onboarding.

## Step by step

1. Go to **Tenants** in the sidebar.
2. Click **Add Tenant** (top right).
3. The **Add Tenant** modal opens and asks you to choose a mode: **Managed** or **Audit-only**. In short: Managed is the full feature set — scheduled polling, alerts, drift detection, the ability to push CA / Intune / security settings — and persists indefinitely. Audit-only is a read-only snapshot for assessments and prospects, and auto-deletes after 14 days plus a 7-day grace period. Choose **before** consenting: an audit-only tenant can be converted to managed later, but a managed tenant can never be converted to audit-only. The next guide covers this decision in detail.
4. Click **Continue to Admin Consent**. You're redirected to Microsoft's admin consent page.
5. Sign in with the Global Admin or GDAP-enabled account for the target tenant and accept the requested permissions. This grants Panoptica365's service principal read access to the tenant's configuration (and the write permissions used by template deployment).
6. You're sent back to the Tenants page with a toast: *"Admin consent granted successfully."*

Behind the scenes, Panoptica365 also assigns the **Exchange Administrator** and **Compliance Administrator** roles to its service principal in the new tenant — these are needed for the Exchange and compliance readers. This is automatic and best-effort; if it doesn't complete, see Troubleshooting below.

## What happens next

The tenant appears in the list immediately with a generated name (you'll fix that in a second) and an empty **Last Polled** column. The first data collection starts in the background. **Give it a few minutes** — there is no progress bar; when the first poll completes, Last Polled fills in and the tenant's dashboard starts showing real data.

While you wait, click the tenant's edit (pencil) action and set:

- **Display Name** — the customer name you want to see everywhere.
- **PSA Name** — the company name as it appears in your PSA, used for ticket attribution (you can skip this until you set up the PSA integration).
- **Language** — the language used for this tenant's AI analysis and reports.
- **Polling (min)** — how often the tenant is polled (1–60 minutes).

Then click **Save**, head to the **Main Console**, and click your new tenant to open its dashboard.

## Troubleshooting

**Consent fails with AADSTS650051.** This is common enough on a *first* consent attempt that Panoptica365 handles it for you: a modal titled *"Consent didn't complete — try once more"* appears. It's almost always a temporary hiccup on Microsoft's side — click **Try again** and the second attempt usually completes. If it keeps failing, expand *"Show cleanup steps"* in that modal for a copy-paste cleanup script.

**Role assignment incomplete.** If you see a toast saying the service principal may still be propagating, wait a minute, then open the tenant's edit modal and click **Re-assign Exchange roles**.

**Wrong account.** If you accidentally consented with credentials for the wrong tenant, you've onboarded the wrong tenant. Delete it (edit modal → **Delete Tenant**) and start over with the right credentials.
