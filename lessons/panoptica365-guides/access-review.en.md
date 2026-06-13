---
title: "Access review — who has admin, who's dormant, and your emergency way back in"
subtitle: "Review every privileged-role holder, disable or delete stale accounts, and set up break-glass accounts that bypass Conditional Access and shout the moment they're used."
icon: "key-round"
last_updated: 2026-06-13
---

# Access review — who has admin, who's dormant, and your emergency way back in

The **Access review** tab on the tenant dashboard answers three questions you should be able to answer about any customer: *who holds administrative roles, which accounts are dead weight, and what happens if a Conditional Access policy locks everyone out.* It sits between **Security** and **Applications**, and it's two tables plus a break-glass workflow.

Everything that writes to the tenant here is operator-initiated, confirmed, and audited — Panoptica365 never disables or deletes an account on its own.

## Table 1 — Accounts with administrative roles

This is a **review-only** roster of every account that holds a watched privileged role, grouped by tier (apex roles like Global Administrator first, then high, then medium). For each account you see its name (linked to the user's blade in Entra), UPN, the roles it holds, whether it's enabled, whether **MFA** is registered, and its last activity.

Two things to read carefully:

- **MFA registered** shows *Yes*, *No*, or a dash. A dash means *we couldn't read a registration record for that account* — it is **not** the same as "no MFA". Don't act on a dash; act on a clear *No*.
- The **apex tier** is where your attention belongs. A Global Administrator without MFA, or three more Global Admins than you remember creating, is the finding this table exists to surface.

There are no action buttons on this table — it's a posture you read, then act on elsewhere (in Entra, or via Table 2 for non-privileged accounts).

## Table 2 — All user accounts

Every account in the tenant, with filter pills: **All**, **Members**, **Guests**, **Inactive**. Columns are account + UPN, type, enabled, last activity, and actions.

**Inactivity** is computed from Microsoft 365 usage reports, not directory sign-in logs — which means it **works on Business Standard**, where the sign-in logs are licensed away. The last-activity column shows the most recent date the account did anything across Exchange, SharePoint, OneDrive or Teams; if that's older than the threshold (90 days by default) the date turns red and the row is flagged **Inactive**. A guest who was invited but never accepted is labelled **Never redeemed** — the cleanest delete candidate there is.

If the tenant has *Display concealed user, group, and site names* turned on, the usage report comes back anonymized and we can't map activity to accounts. Rather than show you garbage, a note appears above the table with a link to turn the setting off.

## Disabling and deleting accounts

**Disable**, **Enable** and **Delete** are operator actions on Table 2. Each opens a confirm dialog that names the account, states what will happen, and reminds you the action is recorded in the audit log. Delete also tells you the account is **recoverable in Entra for 30 days** before removal is permanent.

The guards are enforced on the server, not just hidden in the UI:

- **Delete is refused for any account that holds an administrative role.** Strip its roles in Entra first — this tool won't let you nuke an admin by accident.
- **Disabling the last enabled Global Administrator is blocked.** That's the one click that locks a tenant out of itself.
- A **break-glass account** takes an extra confirmation before it can be disabled or deleted.

Every disable, enable and delete writes to the MSP audit log **and** the tenant's Change log, with the operator, the target UPN, the action and the outcome — so a careless or hostile action is always attributable after the fact.

## Break-glass accounts — emergency access done right

A break-glass (emergency access) account is the credential you reach for when something has gone wrong: a misconfigured Conditional Access policy has locked out every normal admin, or your MFA provider is down. Its whole job is to **bypass the Conditional Access policies** so a human can always get back in and fix things.

Panoptica365 does this the way Microsoft recommends — with a dedicated **group**, not per-account edits. Open **Break-glass accounts** from the Access review tab. The first time, you'll be walked through it.

### Before you start

Create the emergency account in Entra first:

- **Global Administrator**, **unlicensed**, cloud-only, on the **.onmicrosoft.com** domain.
- Give it a **generic name** — never "break glass", "emergency" or "admin". An obvious name is a beacon for an attacker who gets a foothold; pick something mundane (one operator uses *invoicing*). Name the group generically too, and keep only your emergency accounts in it.
- Microsoft recommends keeping **at least two** emergency accounts.

### Point Panoptica365 at the group

Choose your dedicated security group from the picker — we show the name but key on the immutable group ID, so renaming it later won't break anything. There's a hard safety gate here: if you pick a group with more than a handful of members, Panoptica365 stops you, because excluding that group from Conditional Access would exempt *every member* — pointing at "All Staff" by mistake would exempt your whole company. It also checks the group is an assigned security group, not a dynamic one (you can't add members to a dynamic group).

On confirm, Panoptica365 **excludes the group from every Conditional Access policy** and shows you the result policy by policy — excluded, already excluded, or failed. If a write fails it tells you, rather than claiming success — because "excluded from 5 of 7" still means the account can be locked out by the other two. From then on, designating an account is just **adding it to the group**, and the coverage status shows *"Excluded from N of N policies."*

If the tenant is still on **Security Defaults** (no Conditional Access), exclusion is impossible — Security Defaults enforces MFA on everyone with no exclusions. Panoptica365 says so plainly and suggests moving to Conditional Access. You can still designate and monitor the account; the sign-in alert below works regardless.

### The sign-in alert

The moment a break-glass account **signs in**, Panoptica365 raises a **SEVERE** alert — email and a PSA ticket if you have one wired up. A real break-glass login almost always means something broke or someone is somewhere they shouldn't be, so it's meant to be loud. Detection runs off the unified audit log, so it **works without a Premium licence**, and it matches on the account's stable identity — so it still fires even if you've changed the account's domain.

A single sign-in produces one alert (not one per audit record); repeat sign-ins the same day tick its recurrence count up until you resolve it.

### Coverage stays guaranteed

New Conditional Access policies get created over time, and an exclusion can be removed. Panoptica365 keeps verifying that your break-glass group stays excluded from **every** policy and raises an alert if a gap opens — a new policy without the exclusion, or an exclusion that was stripped out. And because the exclusion is something *you* applied, Panoptica365 treats it as expected: it won't flag your own break-glass exclusion as Conditional Access drift.

### The one thing that has changed about break-glass

Microsoft now **enforces MFA on admin-portal sign-ins at the platform level — independent of Conditional Access.** Excluding the account from every CA policy no longer removes the MFA prompt, and the old "no-MFA, just a vaulted password" model is gone. Register a **phishing-resistant** method on the account — a **FIDO2 security key** — and store it in the safe with the password. That's actually *better* for break-glass: a hardware key doesn't depend on the authenticator app or a phone signal, so it still works when the normal MFA path is the thing that's broken.

## When to use this

- **At onboarding:** review the admin roster, flag any admin without MFA, and set up two break-glass accounts with a dedicated group.
- **Periodically:** sweep Table 2 for inactive accounts and never-redeemed guests; disable or delete with the customer's nod.
- **Whenever a break-glass alert fires:** confirm it was a planned use. If it wasn't, you've just caught something.
- **After creating new CA policies:** check the break-glass coverage status (or wait for the gap alert) and re-apply if needed.
