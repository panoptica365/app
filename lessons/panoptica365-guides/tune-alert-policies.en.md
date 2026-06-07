---
title: "Tune alert policies"
subtitle: "Severity, routing, on/off, and notification limits — make the alert stream match how your shop actually works."
icon: "list-checks"
last_updated: 2026-06-07
---

# Tune alert policies

Out of the box, Panoptica365 ships dozens of alert policies with sensible defaults. **Alert Policies** (sidebar) is where you adapt them to your shop — and the difference between an alert stream your team trusts and one they ignore is twenty minutes on this page.

## The layout

Policies are grouped into collapsible categories:

- **Risky Sign-ins** — impossible travel, unfamiliar locations, risk detections.
- **Threat Mgmt** — Defender incidents, malware, phishing signals.
- **Permissions** — role changes, consent grants, app permission growth.
- **Configuration changes** — drift and settings changes, including Message Center items.
- **External Sharing** — anonymous links, external access events.
- **Info Governance** — DLP and compliance-adjacent events.

A search bar filters across names and descriptions; matching sections expand automatically. Each policy row carries the **graduation-cap icon** — the same five-section explainer you get on a live alert, so you can understand a policy before deciding what to do with it.

## What you can change per policy

- **Severity** — info / low / medium / high / severe. Severity drives sorting, the daily briefing threshold, and PSA ticket priority mapping. If your team treats a particular alert type as drop-everything, rate it that way.
- **Routing** — none / personal / support / both. *Personal* goes to your notification recipients (email); *support* goes to your PSA (ticket, or PSA email fallback); *both* does both. Route customer-actionable work to the PSA and operator-awareness items to email.
- **On / Off toggle** — disabled policies don't evaluate at all. Turning a policy off is honest when you genuinely don't care about that signal; resolving its alerts forever while leaving it on is not.
- **Notification limit** (edit modal, Admin) — a per-day cap on notifications from this policy, your brake against a runaway alert flooding inboxes or the PSA board.

Changes here are global — they apply to all tenants. Per-tenant exceptions belong in **exemptions** (next guide), not in policy toggles.

## A tuning method that works

1. **Run the defaults for two weeks.** Don't pre-tune against imagined noise.
2. **Look at what you actually resolved as false positive.** Each recurring false positive is either an exemption candidate (one user, one pattern, one tenant) or a severity/routing mismatch (signal is real but doesn't deserve a ticket).
3. **Promote what burned you.** If something turned into an incident and its alert was rated low, raise it.
4. **Mind the briefing threshold.** The daily summary has its own minimum-severity setting (Settings → Daily Summary). Severity here and threshold there together decide what your 6 AM email contains.

All edits on this page are recorded in the MSP audit log — severity changes, toggles, routing changes. Tuning is accountable work, and it should be.
