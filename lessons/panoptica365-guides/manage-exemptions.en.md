---
title: "Manage exemptions"
subtitle: "Documented, time-boxed exceptions: how they're created from CA, Intune and alerts, and how to keep them honest."
icon: "shield-off"
last_updated: 2026-06-07
---

# Manage exemptions

Every fleet has legitimate exceptions: the service account that can't do MFA yet, the deployment that intentionally differs at one customer, the user whose weird-but-real sign-in pattern keeps tripping an evaluator. Exemptions are how Panoptica365 records those exceptions **explicitly** — with a scope, a reason, an owner, and an expiry — instead of letting them live as reflexively-resolved alerts.

## Where exemptions come from

You don't create exemptions on the Exemptions page. They're created in context, at the moment you accept an exception:

- **CA drift acceptance** — accepting CA policy drift *with expiry* lifts the excluded principals (users or groups) into exemptions. Scope: per-principal.
- **Intune drift acceptance** — same flow; scope is **policy-wide** for that deployment.
- **Alert exemptions** — from an alert's slideout, exempting a recurring pattern: a user, optionally constrained by country and/or IP range. Scope: the pattern.

The default expiry is **180 days**. Accepting requires Operator role or up, and a reason is always required.

## What an exemption actually does

While active, matching alert evaluations are suppressed — and importantly, they're suppressed *accountably*. Alerts resolved by an exemption rule are stamped as such, never reach your PSA, and are excluded from the daily briefing. For CA exemptions, the **suppression count** column shows how many alerts each exemption has absorbed — expand the row to see exactly which events were suppressed, when, and for whom.

That count is your tuning feedback: an exemption that suppressed 47 alerts this month is carrying real weight; one that suppressed zero may no longer be needed.

## The Exemptions page

**Exemptions** (sidebar → System) is the registry. Filter by tenant, by source (CA / Intune / Alert rules), and optionally include revoked and expired entries. Each row shows the source badge, tenant, template, scope (principal, policy-wide, or user-pattern), the **reason**, who accepted it, when, and the expiry with a days-left countdown — bold red under 7 days, orange under 30.

**Revoke** (Operator and up) ends an exemption immediately. The confirmation spells out the consequence: on the next drift cycle the principal or deployment will be flagged again, or future matching alerts will fire normally.

## Keeping the registry honest

- **Reasons are for the next person.** "Per ticket #4321 — CFO travel exception, reviewed with client" beats "ok per client". You'll read these a year later in an audit.
- **Let expiries expire.** The 180-day default is a re-review trigger, not a nuisance. When an exemption lapses and the alert re-fires, that's the system asking *"is this still true?"* — answer it, don't just re-accept on autopilot.
- **Prefer narrow scopes.** One user with country constraint beats policy-wide; policy-wide beats turning a policy off. Use the narrowest tool that stops the noise.
- **Sweep quarterly.** Filter to active, sort through anything with no recent suppressions or an owner who's left — revoke what's stale.

Exemptions are the difference between *"we ignore that alert"* (indefensible) and *"we accepted that risk, documented it, and it expires in March"* (professional). Use them generously and keep them clean.
