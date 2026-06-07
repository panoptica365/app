---
title: "Users, roles and access"
subtitle: "Three tiers gated by Entra groups: who can do what, how to set it up, and how it's enforced."
icon: "users"
last_updated: 2026-06-07
---

# Users, roles and access

Panoptica365 doesn't keep its own password database. Operators sign in with their Microsoft accounts, and what they're allowed to do is decided by **Entra ID group membership** in your MSP tenant. Three groups, three tiers.

## The three roles

**Admin** — full control. Manages tenants (add, edit, delete), all of Settings, alert policy editing, and the audit log. The only role that can onboard or delete a tenant.

**Operator** — the working tier. Deploys CA and Intune templates, applies security settings, accepts drift and creates exemptions, resolves and manages alerts, reruns AI analyses. Cannot touch Settings or tenant lifecycle.

**Viewer** — read-only. Sees dashboards, alerts, reports, heatmap, Learn — everything visible, nothing mutable. Right for techs in training, auditors, or a customer-facing screen.

Sign-in itself is gated by the same groups: an account in none of the three groups cannot log in at all.

## Setting it up

1. In **your MSP tenant's** Entra ID, create three security groups (e.g. *Panoptica Admins*, *Panoptica Operators*, *Panoptica Viewers*) and add your people.
2. In **Settings → Access Control**, paste each group's object ID into the matching field: **Admins**, **Operators**, **Viewers**.
3. Click the verify button next to each — it resolves the group's display name via Graph, confirming you pasted the right GUID.
4. Save. From then on, membership changes in Entra take effect on next login — managing who can do what in Panoptica365 is just managing group membership, which your shop already knows how to do.

If a user lands in multiple groups, they get the highest tier they qualify for.

## How enforcement works

Two layers, and it's worth knowing both:

- **The UI adapts.** Your role badge shows in the sidebar; the System section (Settings, Audit Log) is hidden for non-admins; admin-only buttons (Add Tenant, Delete Tenant, policy editing) disappear or disable; some fields render visible-but-readonly for lower tiers.
- **The server enforces.** Every mutating API endpoint checks the role server-side. The hidden button isn't the security boundary — the 403 is. And every denied attempt is written to the MSP audit log.

So if someone on your team reports a missing button, check their group membership before filing a bug.

## Accountability

Every meaningful operator action — template deploys, settings changes, drift acceptances, alert resolutions, tenant lifecycle, and those 403s — is recorded in the **Audit Log** with actor, timestamp and outcome (see *System administration*). The role model decides who *can* act; the audit log records who *did*.

## Practical advice

- **Be stingy with Admin.** Most of the daily work — deploy, accept, resolve — is Operator-level by design. Two admins is plenty for most shops.
- **Use Viewer deliberately.** It's a safe way to give visibility to juniors, auditors, or a NOC screen without handing anyone a trigger.
- **Review membership when people change roles** — it's an Entra group like any other, and it deserves the same joiner-mover-leaver discipline you give customer tenants.
