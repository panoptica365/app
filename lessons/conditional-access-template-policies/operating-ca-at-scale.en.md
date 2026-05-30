---
title: "Operating CA at scale — drift, exclusions, lifecycle"
subtitle: "How CA policies decay over years, and how drift detection and expiring exclusions keep them trustworthy."
icon: "gauge"
last_updated: 2026-05-29
---

# Operating CA at scale — drift, exclusions, lifecycle

In April 2026, a Calgary MSP discovered that one of their long-time customers — a small accounting firm with thirty users — had been operating with a "Require MFA for all users" policy that had quietly accumulated 19 exclusion entries over four years. Three of the excluded users had left the company. Two were excluded for a service account that had been retired in 2023. Eight were one-time exceptions added during the pandemic and never removed.

The policy was *enabled*. The compliance report showed *MFA enforced for all users*. The audit trail said *the policy has been in place since 2022*. None of those things told the whole truth. The policy was technically on, but a third of the user base had quietly accumulated exemptions that nobody remembered.

This is the operational reality of running Conditional Access over years rather than weeks. The eight previous lessons in card 3 explained what each template does and how to deploy it. This lesson is about what happens next — how a CA policy set evolves, decays, and stays trustworthy across years of customer-tenant operation.

Three subjects: drift, exclusions, and lifecycle. Each deserves its own attention. Each is something Panoptica365 helps with but cannot solve on its own — the operator has to be in the loop.

## Drift — when a deployed policy stops matching its template

A CA policy that you deployed last Tuesday may not be the same policy today. Microsoft can change the underlying schema. A delegated admin user can modify it. A GDAP-using technician at your MSP can adjust it. A customer's other admin (often unknown to your MSP) can edit it. The policy drifts.

Drift takes a few shapes:

**Schema drift** — Microsoft changes the underlying CA policy schema, adds new fields, deprecates old ones. The policy you deployed two years ago may have fields that no longer exist in the current API, or may be missing fields that are now expected. Schema drift is the slow kind; it accumulates across years.

**State drift** — the policy's state changed (Enabled → Report-only, or vice versa, or Disabled). This can happen accidentally during troubleshooting, intentionally during a maintenance window, or maliciously if an attacker has admin access. State drift is binary and easy to detect.

**Scope drift** — the user/group includes or excludes changed. New users added, departed users removed, new groups in or old groups out. This is the kind of drift that accumulates exclusions. Scope drift is the most consequential because it's the easiest to misread — "the policy is still on, what's the problem?"

**Control drift** — the grant or session controls changed. "Require MFA" might have been changed to "Require MFA OR Compliant device," or the policy might have been weakened by adding a session-frequency override. Control drift is the hardest to detect by eye because the policy still looks correct in the portal.

**Condition drift** — the policy's conditions changed. The trusted-location list, the platform list, the client-app list. Less common but possible.

Panoptica365's CA drift detector covers all five categories. The detector periodically reads the current state of each deployed policy via Graph API and compares it to the template baseline (or the previous known-good state for customised policies). Differences fire as drift alerts.

The operator workflow for a drift alert:

1. **Acknowledge the alert.** What kind of drift? State, scope, control, condition, schema?
2. **Identify the cause.** Look at the audit log: who made the change, when, from what role. Panoptica365 records the full attribution chain.
3. **Decide: rollback or accept.** If the change was legitimate (the customer asked for a specific exclusion, a known maintenance), accept and update the template/baseline to match. If the change was unauthorized or unintended, roll back.
4. **Document.** Whether you rolled back or accepted, the change is now visible in your operational record. The next operator who looks at this policy can see what happened.

The hardest part is step 3 — deciding what's legitimate vs. what's not. In a healthy MSP, every CA change should have a corresponding ticket. If a drift alert fires and there's no ticket explaining it, you have either a documentation gap or an unauthorized change. Both are worth investigating.

## Exclusions — the silent debt

The accounting firm story above is the standard pattern. Exclusions are added one at a time, each with a defensible reason at the moment, none with a sunset date. Over years they accumulate. Eventually, a third of the user base is excluded from a policy you believed was protecting them.

The mechanic that fixes this:

**Every exclusion has a sunset date.** Panoptica365's exemption system supports this directly. When an operator adds a user to a CA policy's exclusion list (or accepts a drift event that added an exclusion), the system requires a justification and an expiration date. By default the expiration is 180 days from the addition. The operator can shorten or lengthen, but cannot leave it open-ended.

**Every exclusion gets reviewed before expiration.** Before the sunset date, Panoptica365 alerts the responsible operator. They review: is the exclusion still necessary? Should it be renewed (with a fresh justification)? Or should it expire and the user be brought back into the policy's scope? Active review prevents the silent-accumulation pattern.

**Group-based exclusions are auditable.** Many policies exclude an entire group ("Break-glass accounts," "Service accounts"). The membership of those groups can change without the CA policy itself changing — and the new member is now silently excluded. Periodic audits of the *membership* of exclusion groups are part of the operating discipline.

The honest principle: a CA policy with an empty exclusion list is the goal. Every entry on the exclusion list is a known security gap. The list should be auditable, justified, and reviewed on a regular cadence.

The pattern *not* to fall into:

- "We'll add the exclusion for now and revisit it later." (Later never comes.)
- "Let's just exclude the IT department for convenience." (You've just disabled the policy for everyone with admin access — exactly the wrong shape.)
- "It's been there for years, must be intentional." (Or it's been there for years because nobody removed it.)

Panoptica365's exemption-review workflow exists specifically to prevent these patterns. Use it. The friction of "you have to add a justification and sunset" is the design — it makes the bad patterns harder to commit to than the good ones.

## Lifecycle — how a CA policy evolves over years

A CA policy is not a one-time deployment. It's a configuration that lives alongside the customer's business for as long as the relationship lasts. Over years, the customer changes:

- **They hire and fire.** User population shifts. Groups gain and lose members. Roles change.
- **They acquire other companies.** A new tenant gets merged in (or doesn't). New users arrive en masse with different equipment and different existing CA postures.
- **They open new offices.** New trusted-location entries. New IP ranges. New travel patterns.
- **They adopt new apps.** New apps in the cloud-app list. New OAuth integrations. New service accounts.
- **They upgrade their licensing.** Business Standard → Business Premium → E5. Each upgrade unlocks new CA features (compliant-device CA at Premium, risk-based CA at E5). The CA policy set should evolve to use the new capabilities.
- **They suffer an incident.** Post-incident, the CA posture typically hardens.
- **They face a new regulatory requirement.** Some new compliance obligation requires a new CA policy.
- **They downsize.** User population shrinks. Some users leave. The CA policy needs cleanup.

Each of these is a CA-relevant event. The MSP that's running CA well checks in on the CA policy set:

- **Quarterly** — review every policy. Are the conditions still right? Are the exclusions still needed? Is the customer using the licensing they have?
- **At every customer relationship milestone** — onboarding, renewal, major acquisition, downsizing.
- **After any incident** — post-incident reviews surface CA gaps that need closing.
- **When Microsoft ships new CA features** — periodically Microsoft adds new capabilities (Token Protection became GA in 2024; authentication flows condition followed in 2025). New capabilities should trigger a "could this strengthen the CA policy set" review.

This is the meta-workload of running CA at scale. The shipped templates are the starting point. The drift detection and the exclusion review keep the deployed policies trustworthy. The lifecycle review keeps the policy set *relevant* — strong against the current threat landscape, not the threat landscape of 2023.

## What Panoptica365 does and doesn't do

To be clear about the platform's role:

**Panoptica365 does:**

- Drift detection on every deployed CA policy. Alerts on state, scope, control, condition, and schema drift.
- The exemption / exclusion review workflow. Justifications, sunsets, reminders, audit trail.
- Audit logging for every CA-policy mutation (deploy, modify, disable, exclude). Who, when, from what role, with what reason.
- The Daily Activity widget that shows CA-block volume in near-real-time across the MSP fleet.
- Cross-tenant view: see the CA policy state across every customer at a glance.

**Panoptica365 does not:**

- Decide whether a drift event is legitimate or unauthorized. The operator decides.
- Decide whether an exclusion should be renewed or expire. The operator decides.
- Generate new CA policies in response to new threats. The operator does (using card 8's import workflow if needed).
- Replace the customer's existing CA admin. If the customer has their own admin who's also modifying policies, Panoptica365 surfaces the changes — but doesn't prevent them.

The line is: Panoptica365 makes the state of CA across customers *visible*. The operator's job is to interpret what they see and act on it.

## The annual CA review — a recommended cadence

For each customer, once a year (often timed to the annual renewal conversation), run an explicit CA review:

1. **List all deployed CA policies.** What's enabled, what's report-only, what's disabled.
2. **For each policy, review the exclusion list.** Every entry: still necessary? Sunset date still appropriate?
3. **For each policy, check the drift history over the past year.** Were there any drift events you didn't fully resolve? Any patterns suggesting an unauthorized change history?
4. **Compare against the current Panoptica365 template library.** Are there templates that should be deployed but aren't (newly-shipped policies, recently-added imports)?
5. **Compare against the customer's current state.** Has anything changed (new licensing, new apps, new regulations) that suggests new policies?
6. **Document the review.** The customer's IT director should know that this review happened, what was found, and what was changed.

This annual cycle is what keeps CA from becoming a one-time deployment that decays over years. It's also what the customer needs to demonstrate to an auditor, an insurer, or a regulator: "we review our access controls annually, and here's the record."

## What this means for the operator

Three takeaways for daily and yearly work.

**Drift alerts are not background noise.** Each one is either an authorized change (acknowledge and accept) or an unauthorized change (investigate and roll back). Both require operator attention. The CA policy set's integrity depends on every drift event being resolved cleanly.

**Exclusion lists should be the smallest possible set.** Every entry is a known security gap. The exemption workflow with sunsets is your tool for keeping the list trim. Resist the impulse to add "permanent" exclusions; nothing is permanent.

**The annual CA review is part of the customer relationship.** It's not optional or "nice to have." It's the operating discipline that keeps the customer's CA posture trustworthy. Bill for it. Document it. Make it visible to the customer.

## Closing card 3

You've now seen the nine Conditional Access templates Panoptica365 ships, plus the platform mechanics (import, drift, exclusions, lifecycle) that turn the template library into an operating system.

The arc of the card:

1. Pre-flight checklist — before any template, do these five things.
2. Require MFA for all users — the foundation.
3. Block legacy authentication — close the basic-auth bypass.
4. Trusted location OR compliant device — the smart geo-policy.
5. Compliant OR hybrid OR MFA — the trust-signal OR policy, and the strategy choice with #2.
6. Hardening admin access — four admin templates as a coherent set.
7. Disable device code flow — the Storm-2372 defence.
8. Importing your own templates — Panoptica365's customisation superpower.
9. Operating CA at scale — drift, exclusions, lifecycle (this lesson).

The card 4 (Intune template settings) starts next. Card 4 covers the device side of the trust-signal pair — the policies and configurations that make the "compliant device" signal in cards 3.4 and 3.5 actually mean something. Without reliable compliance, the OR-condition CA policies degrade to single-condition policies. Card 4 is where compliance gets real.

For now: read the policies, deploy them with the pre-flight discipline, monitor them with drift detection, and live with them across years using exclusion sunsets and annual reviews. CA at scale is not glamorous, but the customer's security posture lives or dies on it.

---

*Sources for the data points in this lesson — Microsoft Learn on Conditional Access policy management and audit logging ([Microsoft Learn — Audit logs in Entra ID](https://learn.microsoft.com/en-us/entra/identity/monitoring-health/concept-audit-logs)); CA policy versioning and audit trail ([Microsoft Learn — Conditional Access change history](https://learn.microsoft.com/en-us/entra/identity/conditional-access/howto-conditional-access-policies-audit)); Microsoft Graph API for Conditional Access policy state ([Microsoft Learn — Conditional Access policy resource](https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccesspolicy)).*
