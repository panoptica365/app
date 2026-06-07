---
title: "The tenant dashboard"
subtitle: "Six tabs, two zones: the metric cards, the drill-down panels, and where each workflow lives."
icon: "gauge"
last_updated: 2026-06-07
---

# The tenant dashboard

Click a tenant on the Main Console and you land on its dashboard. This is the single richest page in Panoptica365 — everything known about one tenant, organized into six tabs:

1. **Overview** — the configuration and activity snapshot (this guide).
2. **Alerts** — this tenant's alerts, same workflow as the global Alerts page.
3. **CA Policies** — Conditional Access templates assigned to this tenant (own guide).
4. **Intune Policies** — Intune templates deployed to this tenant (own guide).
5. **Applications** — the enterprise app inventory and approval workflow (own guide).
6. **Change Log** — the history of every change made to this tenant, both changes Panoptica365 made (deployments, applies) and changes operators logged manually. Drift alerts link back to entries here when a change explains them.

## The Overview tab: metric cards

The top zone is a grid of at-a-glance cards. What appears depends on what the tenant has, but expect:

- **Secure Score** — with the comparative average for similar-sized tenants.
- **Identity**: Total Users, Licensed Users, **Global Admins** (green at 2 or fewer, red above 5 — count matters), **MFA Registration** percentage (green at 90%+), Risky Users, Inactive Users (90d).
- **Access control**: Conditional Access Policies (enabled/disabled split), Security Defaults on/off.
- **Devices**: Compliant Devices percentage with a trend arrow, Inactive Devices (90d), Entra Connect sync status.
- **Collaboration**: SharePoint Sites, **Anonymous Links** (high severity if any exist), OneDrive Accounts, Teams (public/private split).
- **Email**: Mailboxes, 7-day Mail Activity, **Inbox Rules** — with an external-forwarding indicator, one of the most common compromise signals.
- **Apps and DNS**: Registered Apps, Enterprise Apps, Domains with MX/SPF/DMARC/Autodiscover validation status.

Treat the cards as a triage surface: anything red or yellow is a question worth answering.

## The Overview tab: drill-down panels

Below the cards, collapsible panels carry the detail behind each card: the licensing breakdown, the actual list of global admins, users without MFA, per-policy CA details, the full Intune device table, top mailboxes by storage, anonymous sharing links by site, all inbox rules grouped by user, inactive user and device lists, registered and third-party apps, and DNS records per domain.

You'll use these panels constantly during assessments and customer conversations — "you have four global admins and two of them are unlicensed accounts nobody owns" comes straight from here.

## Data freshness

Everything on the Overview reflects the **last poll** (the interval you set per tenant, 1–60 minutes, plus slower cycles for heavyweight data). If you've just onboarded the tenant, give the first poll a few minutes; if a card seems stale, check **Last Polled** on the Tenants page.

## Where to next

A sensible first pass over a freshly onboarded tenant: skim the Overview for anything alarming, then work through **Applications** (approve what you trust), then **CA Policies** and **Intune Policies** (deploy your baselines), then **Security** (the tenant-wide settings surface, from the sidebar). The next four guides walk through each.
