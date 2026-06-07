---
title: "Review applications — approve what you trust, triage the rest"
subtitle: "The Applications tab workflow: Refresh, mark Known good, Save — and let Sonnet triage everything you didn't approve."
icon: "app-window"
last_updated: 2026-06-07
---

# Review applications — approve what you trust, triage the rest

Every tenant accumulates enterprise apps and app registrations — some installed deliberately, some consented to by users years ago, some malicious. The **Applications** tab on the tenant dashboard turns that pile into a reviewed inventory with a protected baseline.

Microsoft's own first-party applications are excluded automatically — you only review what's third-party or custom.

## The workflow

1. Open the tenant dashboard → **Applications** tab.
2. Click **Refresh** if the inventory hasn't been pulled recently. You'll see *"Refreshing from Microsoft Graph…"* while it fetches the live list.
3. Go through the list. For every app you recognize and trust — apps you installed, apps the customer confirms they use — tick its **Known good** checkbox. Expand a row to see its delegated and application permissions, credentials and redirect URIs if you need to look closer. A *Verified publisher* checkmark and a *tenant-wide* tag on scopes help you judge.
4. When in doubt, **ask the client**. "Do you use something called Acme Sync?" is a thirty-second call that beats guessing.
5. Click **Save**. Two things happen:
   - Apps you checked are **marked known-good** and get a **protected baseline**: their current permission set is snapshotted.
   - Every app you *didn't* check is sent to **Sonnet for triage**. The progress line reads like *"Saving… 12 app(s) marked known-good; sending 9 to Sonnet for triage."*

## Reading the triage results

Each unapproved app comes back with a colored assessment dot:

- **Green — nothing alarming.** Publisher, age, consent type and scopes look ordinary.
- **Yellow — worth a look.** Something is unusual enough to deserve your eyes.
- **Red — investigate.** Review this app now, with the client if needed.

Mind the disclaimer shown in the UI: this is *triage, not a guarantee*. The dot reflects what Sonnet could infer from publisher, age, consent type and scopes. Only marking an app **Known good** stores a protected baseline. Use red/yellow dots as a worklist: investigate, then either mark the app known-good or remove it from the tenant (the **Delete ↗** link takes you to the right place in Entra).

## What the baseline buys you

Once an app is known-good, Panoptica365 watches it. If it later **gains permissions beyond its approved baseline**, the row flags *"Permissions changed since approved"* and an alert fires. Permission *removals* don't fire — only growth past what you approved. The comparison runs on every Refresh and on a daily automatic loop.

This is the defense against a classic attack pattern: a legitimate, long-trusted app whose credentials are stolen and which suddenly sprouts `Mail.Read` for the whole tenant. You approved what it was — Panoptica365 tells you when it becomes something else.

## When to redo this

- After onboarding: do the full pass once, with the customer's confirmation where needed.
- When a new-app or consent alert fires: review the app, then bless it or kill it. Blessing an app auto-resolves its open consent alert.
- Periodically (quarterly is plenty): hit Refresh, check for new yellow/red dots.
