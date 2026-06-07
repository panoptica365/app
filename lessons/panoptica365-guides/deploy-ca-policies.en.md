---
title: "Deploy Conditional Access policies"
subtitle: "Assign templates from your library, deploy them to the tenant, and let drift detection guard them afterward."
icon: "key-round"
last_updated: 2026-06-07
---

# Deploy Conditional Access policies

Conditional Access is where Panoptica365 stops being a camera and becomes a guardrail. You maintain a **template library** of CA policies (sidebar → **CA Policies**), assign templates to tenants, deploy them, and Panoptica365 then watches the live policies for drift — forever.

**Before your first real deployment, read the *pre-flight checklist* lesson in the Conditional Access card of Learn.** Break-glass accounts and service-account inventory are not optional. A CA policy deployed in haste can lock an entire customer out.

## Assigning templates to a tenant

1. Open the tenant dashboard → **CA Policies** tab. On a fresh tenant you'll see *"No CA policy templates assigned to this tenant yet."*
2. Click **Assign Template**. A picker lists your template library (minus anything already assigned).
3. Check the templates you want — or **Select All** — and confirm.

Each assignment becomes a card on the tab showing the template name, a drift status badge, the **Grant** controls, target **Users** and **Apps**, an **Alerts** routing dropdown (email, PSA, both, or none — per assignment), and **Last Checked**.

## Deploying

An assigned template isn't live yet. On the assignment card:

- **Deploy** — creates the live policy in the tenant from the template. Tenant-specific placeholders (like named locations) are resolved at deploy time.
- **Check Drift** — compares the live policy against the template right now, on demand (the scheduled drift cycle also does this continuously).

Deploy to **report-only first** when the template is set up that way, watch sign-in impact, then switch to On — that discipline is covered in the CA lessons.

## Drift: the badges

Each assignment card carries a status badge:

- **ok** — live policy matches the template.
- **drifted** — something changed in the tenant; the policy no longer matches.
- **accepted** — drift exists, but an operator reviewed and accepted it.
- **missing** — the policy doesn't exist in the tenant (deleted, or never deployed).
- **unchecked** — not yet compared.

When drift is detected you also get an **alert** through the routing you chose, with AI analysis attached. The drift log on the card shows the timeline: which field changed, expected vs actual, disable/delete events, and remediations.

## Responding to drift

You have three honest options:

1. **Push Template** (also shown as **Remediate**) — overwrite the live policy with the template. **Warning, and the button means it:** this wipes per-tenant `excludeUsers` / `excludeGroups` that were added directly in the tenant. If those exclusions are legitimate, they should live in the template or as exemptions, not as console-side edits.
2. **Accept the drift.** Clicking a drifted policy opens **Accept CA Policy Drift**, showing expected vs actual per field, with two paths:
   - **Accept with expiry** *(recommended)* — the drift is accepted until a date you choose (180 days by default), a **reason is required**, and excluded principals are lifted into the **Exemptions** table so alert evaluators skip them until expiry. Time-boxed, documented, auditable.
   - **Accept Once, forever** — accepted indefinitely; re-fires only if the drift signature changes. Use sparingly.
3. **Update the template** — if the change is actually right for every tenant, fix it at the source in the CA Policies library.

## Operating note

Drift on a CA policy is one of the highest-value alerts the platform produces. A helpdesk tech "temporarily" excluding a user from MFA is exactly how breaches start — and exactly what this catches. Don't train yourself to accept drift reflexively; every acceptance should have a reason you'd be comfortable reading in the audit log a year later.
