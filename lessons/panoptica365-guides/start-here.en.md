---
title: "Start here — what Panoptica365 does and how to use these guides"
subtitle: "The two-minute orientation: what the platform watches, how alerts drive your day, and the order to read these guides in."
icon: "flag"
last_updated: 2026-06-07
---

# Start here — what Panoptica365 does and how to use these guides

Welcome. If this is a fresh install and you're wondering what to click first, you're in the right place.

## What Panoptica365 is

Panoptica365 continuously monitors the Microsoft 365 tenants you manage. It polls each tenant on a schedule, compares what it finds against the policies and baselines you've chosen, and raises an **alert** when something drifts, breaks, or looks suspicious. AI analysis (Claude) is layered on top: every alert gets a plain-language assessment, and daily summaries keep you oriented without living in the console.

The most important thing to understand on day one: **Panoptica365 is alert-driven, not patrol-driven.** You do not need a morning routine of clicking through every tenant. You set up your tenants and policies once, and then you respond to alerts as they arrive — by email, by PSA ticket, or in the Alerts page. The console is there for investigation and setup, not for daily rounds.

## What it watches

Once a tenant is onboarded, Panoptica365 tracks (among other things):

- **Conditional Access policies** you've deployed from templates — and any drift from them.
- **Intune configuration policies** — same template-and-drift model.
- **Security settings** across M365, Entra, Exchange, Teams and SharePoint.
- **Enterprise applications and app registrations** — with AI triage of anything you haven't approved.
- **Sign-in activity, audit log events, and Defender incidents** — evaluated against dozens of alert policies.
- **Secure Score, users, devices, mailboxes, inbox rules, sharing links** and more, all visible on each tenant's dashboard.

## Your first day, in order

These guides are written in the sequence a new operator should follow:

1. **Add your first tenant** — the consent flow, and what credentials you need.
2. **Managed vs audit-only** — the one decision you make before consenting.
3. **The Main Console** — your fleet at a glance.
4. **The tenant dashboard** — what all those cards and tabs mean.
5. **Review applications** — approve the apps you trust, let AI triage the rest.
6. **Deploy CA policies** and **Intune policies** — templates, drift, remediation.
7. **Monitor security settings** — the tenant-wide drift surface.
8. **Work the alerts** — your actual day-to-day.

After those, the remaining guides cover tuning (alert policies, exemptions), fleet-wide views (Heatmap, Daily Activity), reports, and administration (notifications, PSA, users and roles, system settings).

## A note on roles

Panoptica365 has three access tiers: **Admin**, **Operator**, and **Viewer**. Some steps in these guides — adding tenants, changing Settings — require the Admin role. If a button described here is missing or disabled for you, that's role gating, not a bug. The *Users, roles and access* guide explains the model.

## Where to get deeper knowledge

This card is the *how-to* for the platform itself. The other cards in Learn are the *why*: M365 security fundamentals, Conditional Access design, Intune settings, email security, Secure Score, and identity attack patterns. The guides link to them where it matters — for example, read the CA pre-flight checklist lesson before deploying your first Conditional Access policy to a real customer.

Next: **Add your first tenant**.
