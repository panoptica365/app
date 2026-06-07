---
title: "Work the alerts"
subtitle: "Your actual day-to-day: triage, the detail slideout, AI analysis, the Identity Timeline, and resolving with discipline."
icon: "bell-ring"
last_updated: 2026-06-07
---

# Work the alerts

Everything else in Panoptica365 exists to feed this page. Alerts are how the platform talks to you: drift, risky sign-ins, audit-log events, Defender incidents, configuration changes — all normalized into one queue with AI analysis attached.

## The queue

**Alerts** (sidebar) shows every alert across the fleet; the **Alerts tab** on a tenant dashboard shows the same thing scoped to one tenant. The filter bar covers tenant, severity, status, category, and whether resolved alerts are shown.

- **Severities**: info, low, medium, high, severe.
- **Statuses**: **New** → **Investigating** → **Resolved** or **False Positive**.

Each row shows the severity badge, tenant (or *MSP-wide scope* for fleet-level alerts like Message Center items), the message, category, time, a recurrence count, and the status pill.

## Triage, including in bulk

Select alerts with the checkboxes and use the bulk bar: **Mark Investigating**, **Mark Resolved**, **Mark False Positive**, or **Merge**. Merge rolls 2+ related alerts from the same tenant into one parent — useful when a noisy incident produced a dozen siblings. You'll be offered a sensible title and can write your own.

When you resolve alerts that have linked PSA tickets, one modal asks once: *close the linked tickets too, or leave them open?* — and applies your choice to the whole batch.

## The slideout: where investigation happens

Click a row and the detail slideout opens:

- **Details** — the structured facts of the event.
- **AI Analysis** — Claude's read of the alert: what likely happened, how serious it is, and what to check. This is your starting point, not your conclusion.
- **Raw Data** — the underlying event payload when you need ground truth.
- **Timeline** — recurrences of this alert over time.
- **Linked Operator Change** — if a logged change in the tenant Change Log explains this alert (within the attribution window), it's linked here. "Drift detected" plus "Jacques deployed an updated template 40 minutes earlier" is a closed case.
- **Notes** — your investigation notes, kept with the alert.

Next to the policy name you'll find the **graduation-cap icon** — the Alert Explainer. It opens *About this alert*: what this alert type is, why it matters, the attack vectors behind it, what to do, and an example scenario. In your language, written for the tier-1 tech you delegate to.

## The Identity Timeline

For any user-bearing alert, open the **Identity Timeline** from the slideout. It assembles, for that user, a single timeline across four sources — sign-ins, unified audit log events, Defender incidents, and related alerts — over a 24-hour or 7-day window, then has Claude correlate it: *possible compromise, brute force, password spray, failed auth only,* or *inconclusive*, with reasoning.

It's deliberately conservative — it will not narrate a compromise that isn't supported by the events. Deep links take you to the user in Entra and the incident in Defender; **Re-analyze** (Operator role and up) reruns the correlation after things change.

## Resolution discipline

Two habits make the difference between a tuned system and a noisy one:

1. **False Positive is a signal, not a shrug.** If an alert type keeps producing false positives for a known, legitimate pattern, stop resolving them one by one — create an exemption or tune the policy (next two guides).
2. **Resolve with the ticket.** If you run a PSA, let the bi-directional sync do its work: closing the Autotask ticket resolves the alert, and vice versa. One record of work, not two half-records.
