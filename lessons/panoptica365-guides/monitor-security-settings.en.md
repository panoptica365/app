---
title: "Monitor security settings"
subtitle: "The tenant-wide drift surface: settings across M365, Entra, Exchange, Teams and SharePoint — read, compared, and guarded."
icon: "sliders-horizontal"
last_updated: 2026-06-07
---

# Monitor security settings

CA and Intune policies are objects you deploy. But a tenant's security posture also lives in dozens of scattered switches: Exchange transport settings, Teams external access, SharePoint sharing, Entra defaults, anti-phishing policies. The **Security** page (sidebar → Policies → **Security**) is where Panoptica365 reads those switches across every tenant and tells you when one flips.

## What you see

Pick a tenant and you get the monitored settings, grouped by category, with filter chips:

- **Category**: All / Exchange / Identity / SharePoint / Teams / Compliance.
- **Priority**: All / Critical / High / Medium / Low.

Each setting row shows its name, the current live value (interpreted into plain language, not raw API output), the license it requires if any, and a status:

- **Monitored, OK** — live value matches what you've configured as the desired state.
- **Drift Detected** — the live value no longer matches. This also fires a security-drift alert through the normal alert pipeline.
- **Not Applied** — you haven't set a desired state for this setting on this tenant yet.
- **Poll Error** — the reader couldn't fetch the value (often license or permission related).

Click a setting for the detail view: what the setting does, why it matters, the user impact of changing it, operator notes, and the expected vs actual values when drifted.

## Applying and matching

Two verbs cover the workflow:

- **Apply** — push the configured desired value to the tenant. Applies run **asynchronously**: the job is queued, a worker executes it, and the row updates when it completes (with a refresh check shortly after to confirm the value stuck). You can keep working while it runs.
- **Match** — adopt the tenant's current live value as the desired state. Use this when the tenant's existing configuration is correct and you just want it *guarded* from now on.

That distinction matters during onboarding: for a well-configured tenant you'll mostly Match (capture reality as the baseline), and for a neglected one you'll mostly Apply (impose your standard). Either way, the end state is the same — every setting has a desired value, and any future deviation produces a drift alert.

## Audit-only settings

A few settings are deliberately **audit-only** — Panoptica365 reads them but will not write them, typically because the write is license-gated or too sharp-edged to automate (DLP configuration is the canonical example). For these, you **capture a baseline** of the current configuration; from then on, any change to it alerts: *"Baseline captured. Panoptica365 will alert on any DLP configuration change going forward."* Remediation, when needed, is done by hand in the Microsoft console.

## Recommended values

Setting detail views describe the recommended posture, but "most secure" is not "universally correct" — some settings legitimately vary with the customer's business model (external sharing for a company that collaborates with clients in SharePoint, for example). The recommendation text says *for whom* a value is recommended. Read it before bulk-applying anything.

## Where this shows up elsewhere

The **Heatmap** (see *Fleet views*) is built from exactly this data — every tenant × every monitored control, as colored dots. A control that's red or unconfigured across most of the fleet becomes a remediation campaign; the heatmap will hand you that list.
