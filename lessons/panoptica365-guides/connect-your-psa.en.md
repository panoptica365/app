---
title: "Connect your PSA"
subtitle: "Native Autotask integration: credentials, ticket defaults, tenant-to-company mapping, and bi-directional resolution."
icon: "ticket"
last_updated: 2026-06-07
---

# Connect your PSA

If your shop runs on a PSA, alerts should be tickets — created in the right company, at the right priority, and closed from either side. Panoptica365 integrates natively with **Autotask** (Settings → PSA Integration, Admin role).

## 1. Credentials

Enter your Autotask **API username**, **integration code**, and **secret**, then click **Test connection**. On success the integration discovers and stores your Autotask zone: *"Connected — zone …"*. The secret is write-only after saving — the field shows *"Saved — leave blank to keep current"*.

## 2. Ticket defaults

Define what a Panoptica365 ticket looks like in your world:

- **Queue**, **Source**, **New-ticket status**, and **Publish** (visibility) for created tickets.
- **Close status** — the status applied when Panoptica365 closes a ticket.
- **Complete statuses** — the set of Autotask statuses that count as "done". When your team moves a ticket into any of these, the linked alert auto-resolves. The close status must itself be in this set — the form enforces it.
- **Severity → Priority mapping** — one row per alert severity (severe, high, medium, low, info) to your Autotask priorities.
- **Due-date offset** — hours until ticket due date (default 24).
- **Ticket language** — en/fr/es for ticket bodies.
- **Default company for MSP-level alerts** — where fleet-wide (non-tenant) alerts land.

## 3. Tenant → company mapping

The mapping table pairs each Panoptica365 tenant with an Autotask company. Use **Suggest** to auto-match by name (it considers both the display name and the tenant's PSA Name field), fix anything it got wrong with the searchable company picker, and **Save** — all rows in one batch. The footer counts unmapped tenants: those fall back to **email** delivery (your PSA Email Address) instead of API tickets, so finish the mapping.

## How it behaves day to day

- **One ticket per problem.** Alerts deduplicate per (tenant, alert policy): if the same issue fires again while its ticket is open, the new occurrence is **appended as a note** to the existing ticket, not raised as a duplicate. Your board stays readable during a noisy incident.
- **Bi-directional resolution.** Close (or complete) the ticket in Autotask → the alert resolves in Panoptica365 on the next sync. Resolve the alert in Panoptica365 → a modal asks *"Close the linked Autotask ticket?"* — in bulk operations it asks once for the whole batch.
- **Exemption-resolved alerts never become tickets.** Suppressed noise stays out of the board entirely.
- **Routing still applies.** Only alerts whose policy routes to **support** or **both** create tickets (see *Tune alert policies*).

## Health

The settings page shows integration **Health**: last sync, open linked tickets, sync errors, and authentication status. If Autotask auth starts failing, you'll see *"Autotask authentication failing since …"*, a system alert fires, and ticket-bound alerts automatically fall back to the PSA email address until auth recovers — delivery degrades, it never disappears. Which is also why the PSA Email Address should stay configured even after the native integration is live.

Running a different PSA? Use the email path: most PSAs ingest email-to-ticket, and the Attribution String with `${PSA_NAME}` (see *Configure notifications*) lets your PSA route those emails to the right company automatically.
