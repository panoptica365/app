---
title: "Where Panoptica365 sits in this picture"
subtitle: "Panoptica365 is not a replacement for Defender — it's the fleet-wide noticing and triage layer MSPs were missing above Microsoft's single-tenant portals."
icon: "map-pin"
last_updated: 2026-05-29
---

# Where Panoptica365 sits in this picture

*"We already have Defender. Why are we paying for Panoptica365?"*

You will get this question. From customers. From new operators at your own MSP. Maybe from yourself, after a 90-minute Defender XDR session that did not produce a single action item. It's a fair question, and the answer is more interesting than "we monitor more things."

Panoptica365 is not a replacement for Defender XDR, Conditional Access, Intune, or any other Microsoft product. It is a layer that sits *above* them, designed for one job: making the operator's daily work across a fleet of customer tenants tractable.

This lesson is what that means in practice — what Panoptica365 watches, what it deliberately does *not* do, why, and where the product fits in the daily rhythm of an operator's job.

## The four jobs of an M365 operator

Take a step back from products for a moment. An MSP operator working on M365 has four jobs, in roughly this order of frequency:

1. **Notice when something has changed** in a customer tenant that shouldn't have.
2. **Triage alerts** from across many tenants and decide which need action today.
3. **Apply controls** when a customer needs a new policy, a new template, a new compliance baseline.
4. **Forensics** when something has gone wrong and you need to understand what happened.

Microsoft has built world-class tooling for **job 4** — Defender XDR is excellent at forensics, especially for one user, one device, one incident at a time.

Microsoft has built reasonable tooling for **job 3** — the Intune portal, the Conditional Access policy editor, the Exchange admin centre. They work, in the way 1990s software worked. You can run a customer this way; you'll just spend a lot of time clicking.

Where Microsoft has not built much is **jobs 1 and 2** — *fleet-wide noticing and triage*. The portals are single-tenant. The dashboards assume you live inside one customer's portal at a time. Defender XDR's MSP-multi-tenant features are a recent addition and not yet what you'd build if you started from "an MSP manages 30 customers and needs one screen to look at."

Panoptica365 is the product we built because *jobs 1 and 2 were not tractable at MSP scale with what Microsoft ships*.

## What Panoptica365 actually monitors

Concretely, across every tenant connected:

**Identity and Conditional Access.** MFA enforcement per user, sign-in patterns (foreign-IP, impossible-travel), CA policy drift (a template you deployed yesterday looks different today), CA assignment changes, named-location changes, authentication-method registration changes.

**Intune templates and compliance.** Template drift, compliance-policy drift, device-enrolment patterns, EDR-coverage gaps.

**Exchange Online security posture.** The anti-phish preset, mailbox audit posture, inbox-rule changes, mailbox-level forwarding, Safe Links and Safe Attachments configuration, mail-flow-rule changes.

**SharePoint and OneDrive sharing.** External sharing posture, anonymous links, guest access patterns, site permission inventory.

**Unified Audit Log + Defender XDR ingestion.** 25 detection evaluators across the UAL feed and Defender XDR incidents — credential-stuffing patterns, suspicious sign-in chains, OAuth consent grants, mailbox-permission grants, device-code anomalies, BEC indicators, ransomware-staging behaviour.

**Secure Score.** Daily snapshot, trend, comparison against industry baselines.

**Security Settings Engine.** 17 specific Microsoft security settings monitored for drift against a baseline you define — anti-phish list contents, authentication-method configurations, DLP policy state, and others.

That's the catalogue today. It moves. Most of card 2 (*Identity Threats*) maps directly onto specific evaluators in this list. When we say a card "covers" an attack pattern, what we mean is: this attack triggers one or more of these evaluators, the alert lands in Panoptica365, and you act on it from there.

## What Panoptica365 deliberately does not do

This part is more important than the catalogue above, because it's what makes Panoptica365 different from Inforcer, Octiga, 365Sentri, and the other policy-enforcer products in this space.

**We do not auto-remediate.** Panoptica365 will not push changes into a customer's M365 tenant on its own initiative. When something drifts, we tell you what drifted and we recommend a fix. We do not enact the fix.

Why: the failure mode of automatic remediation is shipping a misconfigured baseline at 2 AM across 30 tenants. Recovering from that is much worse than the marginal extra work of an operator clicking "apply." The "we'll never break your customers" guarantee only works if we keep our hands off the steering wheel.

**We do not run destructive actions inside the Microsoft portal on your behalf.** There is no "disable user" button in Panoptica365, no "reset password" button, no "revoke session" button. Those actions exist in Microsoft's portals; we deep-link you to where the action lives, and you make the call.

Why: same logic. Wrapping Microsoft's destructive actions in a third-party UI is a customer-incident waiting to happen. Read-only by design.

**We are not a SIEM.** Panoptica365 does not ingest firewall logs, third-party application logs, or non-Microsoft telemetry. If a customer needs that, the answer is Microsoft Sentinel (lesson 4) or a dedicated SIEM, not Panoptica365.

**We do not replace Defender XDR.** When an attack chain unfolds and you need to drill into one user's session timeline, that's a Defender XDR job. Panoptica365 surfaces the existence of the chain; Defender XDR shows you the inside of it. The two tools are designed to be used together, not in competition.

**We are not a managed-service offering.** Panoptica365 is a product. There is no Panoptica365 SOC team handling alerts on your behalf. (Augmentt sells that separately; Acronis sells Octiga that way. We don't.) The operator's job stays the operator's job.

## How Panoptica365 fits the operator's day

The realistic daily rhythm for an MSP operator using Panoptica365:

**Morning.** Open Panoptica365. The main dashboard shows you, across all customer tenants, what alerts fired overnight, what drift was detected, what the Defender XDR incidents look like. The morning briefing email summarises this in 30 seconds of reading; the dashboard is for the items that need attention.

**Triage.** Click into a specific alert. The alert slideout gives you the structured detail (who, what, when), the AI analysis (Haiku-generated explanation tailored to the customer's licence tier), the related explainer (the graduation-cap icon — the in-context cousin of this curriculum), and the recommended next action. From the slideout you decide: acknowledge, exempt, or open the relevant Microsoft portal to investigate and act.

**Apply.** When a customer needs a new policy — a CA template, an Intune compliance policy, an EXO setting — you deploy it from Panoptica365's template library. Panoptica365 does write here, but only for actions the operator explicitly chose and only with full audit trail.

**Forensics.** When an incident requires real investigation, you leave Panoptica365 and go to Defender XDR. Panoptica365's job at that point is to have made it obvious the investigation was needed.

**Documentation.** Panoptica365 keeps a Tenant Change Log per customer (every operator action), an MSP Audit Log across all operators (who did what, when, from what role), and an Exemption record (when an alert was deliberately suppressed for a reason). Most of the work for "show me what changed in the last 30 days," "what did the audit team need to see," or "what's the evidence we did our job" lives in those three views.

## The "preventive-by-design" stance

Panoptica365 has a philosophical posture that the other products in this category mostly don't share: we believe the operator should be in the loop on every change to a customer's tenant.

This shows up as a constellation of design choices:

- **Read-only by default.** We can monitor everything; we modify only what the operator explicitly asks for.
- **Exemptions are first-class.** When a control doesn't apply to a customer (regulatory reasons, business model reasons, technical reasons), the operator records an exemption with a justification and an expiration date. Future operators see the justification.
- **Audit-logged mutations.** Every change Panoptica365 makes to a customer tenant is logged with the operator's identity, role, and reason. If you didn't make the change, you can prove it. If you *did* make the change, you can show your work.
- **No silent fixes.** When Microsoft does something that re-creates drift (a Microsoft-side default change, for example), the operator gets an alert. We don't silently "re-baseline" — that would erase visibility into what Microsoft did, and that visibility is the whole point.

The competition disagrees with this stance, and it's a legitimate disagreement. Auto-remediating shops believe the marginal risk of a bad change is outweighed by the labour saved on routine fixes. They might be right for some customers; they're definitely wrong for some others. Panoptica365 is the right tool for MSPs whose customer base does not tolerate "we broke something at 2 AM" as an acceptable failure mode.

## How smart MSPs charge for Panoptica365

A piece of business-model advice that should reach you sooner rather than later: Panoptica365 is a tool to make your MSP better at protecting customers — not a product to sell to those customers directly.

When your MSP adopts Panoptica365, the smart play is to bundle the cost into your existing per-user or per-device monthly fee. Don't line-item it on the customer's invoice. At roughly $1 per user per month, it's a small absorbable cost inside a service you're already charging for. Line-iteming it creates two conversations you don't want: the customer asks "what is Panoptica365?" — and you now have to explain a tool that was meant to be invisible — and they may try to negotiate it out — *"we don't need a security monitoring tool, do we?"* Both conversations make your MSP weaker, not stronger.

The pitch to the customer stays simple: "we monitor your M365 security continuously, we triage alerts daily, we report on posture monthly, we deploy and review policy templates." Panoptica365 is the *how*. The customer pays for the *what*. They don't need to see the brand to benefit from it.

This is also why our own marketing leans MSP-side, not end-customer-side. We're not trying to be a recognised name to your customer's CFO. We're trying to be the tool an operator quietly opens every morning to make the day tractable.

## What this means for the operator

Three takeaways for daily work.

**Panoptica365 tells you something needs attention; Microsoft's tools tell you what to do about it.** The hand-off is intentional. When you click "open in Defender" from an alert, you are not abandoning Panoptica365; you are using it as designed.

**Read-only is the feature, not the limitation.** When a customer's CISO asks "what does Panoptica365 do to our tenant?", the answer is: nothing the operator didn't approve. That's a saleable position in regulated industries and risk-averse mid-market customers.

**Documenting the "noticing" half is half the job.** Every alert acknowledged, every exemption granted, every template deployed gets recorded. If you need to demonstrate due diligence — to an auditor, to an insurer, to a customer in a renewal conversation — the audit log and change log are where the evidence lives. Use them. Reference them in client reports.

## What's next

You've finished the Welcome card. The map is laid.

Next up is **card 2: Identity Threats & Attack Patterns**, where we walk through the six specific attacks Panoptica365 was built to surface — credential stuffing, MFA fatigue, AiTM phishing, OAuth consent phishing, device-code abuse, and the BEC patterns that follow compromise. By the end of card 2, every alert in your queue should map to one of those six (or, occasionally, several at once).

After that, the control cards: Conditional Access (card 3), Intune (card 4), Email hardening (card 5), and Secure Score (card 6).

For now: Panoptica365 is the layer that makes "managing 30 tenants" tractable without taking Microsoft's job away from Microsoft. The threats from card 2 will arrive in your queue. Your job, as the operator, is to notice. Ours, as the tool, is to make noticing easy.
