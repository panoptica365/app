---
title: "When the MSP is the target"
subtitle: "Compromising one MSP unlocks every client at once — why you are the highest-value target in the room and what to harden today."
icon: "crosshair"
last_updated: 2026-05-29
---

# When the MSP is the target

You are reading this lesson inside your own MSP's Panoptica365 instance. The "operator" we keep addressing in this curriculum is *you*. The "customer tenant" we keep talking about belongs to one of *your* clients. The privileged credentials that hold the whole pyramid together — the GDAP relationships, the multi-tenant app registration, the PSA admin account, the RMM master account — sit, in many MSPs, inside one tenant. Yours.

If you have spent the last six lessons learning how to protect customers from credential stuffing, MFA fatigue, AiTM, OAuth consent, device-code abuse, and BEC, the closing lesson of this card is the one that asks you to apply all of it to *your own* organisation.

Because here's the unwelcome reality: in 2026, sophisticated attackers do not target your customers one at a time. They target *you*. And if they get in, they get all of you.

This lesson is why MSPs are economically attractive targets, what the canonical attacks look like, what the MSP's specific attack surface is, and the hardening that should be in place inside your own Panoptica365 admin account *before* tomorrow morning.

## The economic shape

Attackers think in terms of return per unit of effort. An average ransomware compromise against an SMB might yield $50,000 in ransom paid (often less). The same effort spent compromising one MSP that manages 50 SMBs yields *50 times* the potential extortion surface, plus an enormous data exfiltration prize, plus the option to deploy ransomware downstream simultaneously across the entire customer base.

This is the multiplier. It is the single reason MSPs are now ranked among the highest-value targets in cybercrime economics, alongside healthcare networks and critical infrastructure. The Five Eyes intelligence agencies (CISA, NCSC-UK, ACSC, CCCS, NCSC-NZ) issued a joint advisory in mid-2022 explicitly naming MSPs as a critical target category and warning that attacks were increasing. The volume hasn't slowed since.

The attackers running these operations are not amateurs. They include nation-state actors (Storm-2372 / Russia, Volt Typhoon / China, others), criminal affiliate networks operating under ransomware-as-a-service brands (LockBit successors, ALPHV/BlackCat, Akira), and increasingly specialized "initial access broker" groups whose entire business is selling MSP-level compromises to whoever pays the most.

You are competing for their attention with about a hundred peer MSPs in your region. You will not always be the one they choose, but every quarter a few MSPs somewhere in North America do get chosen, and the consequences are catastrophic.

## The canonical case: Kaseya 2021

On July 2, 2021, the REvil ransomware group exploited a zero-day vulnerability in Kaseya VSA — a remote monitoring and management (RMM) platform widely used by MSPs. About 60 managed service providers were compromised. Through those 60 MSPs, the attackers deployed REvil ransomware to over 1,000 downstream customer companies. The attackers demanded $70 million for a universal decryption key.

The Kaseya incident is the canonical case study because it demonstrated the *exact* multiplier in action: a single supply-chain compromise of one RMM tool → 60 MSPs → 1,000+ end customers, all encrypted simultaneously, all within a few hours of the initial push. CISA and the FBI issued joint guidance for affected MSPs in the days that followed.

Kaseya was a software-supply-chain attack — exploiting a vulnerability in the RMM tool itself. But the same multiplier applies to attacks against the MSP's *own M365 tenant*, the MSP's *credential vault*, or any account inside the MSP that has GDAP / delegated access to customer environments. Those attacks don't require a zero-day; they require any of the methods from lessons 1–6 applied against the MSP instead of the MSP's customers.

## What sits inside your MSP, ranked by attacker value

Walk through your MSP's environment from an attacker's perspective. The crown jewels:

**1. Your M365 tenant's Global Admin accounts.** If the attacker compromises a Global Admin in your tenant, they typically also gain access to all the multi-tenant app registrations you use to access customer tenants (including Panoptica365's app). Game over.

**2. Your Partner Center / GDAP relationships.** If you're a Cloud Solution Provider (CSP) or use Granular Delegated Admin Privileges (GDAP) to access customer tenants, the credentials that authorise those relationships sit in *your* tenant. Compromise of an MSP admin who has GDAP roles converts directly into customer-tenant access at the role level the GDAP grants.

**3. Your RMM tool's master account.** ConnectWise Automate, Datto RMM, NinjaOne, Kaseya VSA, Atera — all of these can push scripts to managed endpoints across your entire customer base. An attacker with master-account access to your RMM is one click away from deploying malware to every customer device you manage.

**4. Your PSA's admin account.** Autotask, Halo PSA, ConnectWise Manage. PSA tickets contain enormous quantities of sensitive customer information — passwords in plaintext (still, in 2026, more often than you'd hope), customer financial details, network diagrams, escalation contacts. A compromised PSA is an exfiltration goldmine.

**5. Your credential management tool.** IT Glue, Hudu, Passportal, Keeper, LastPass, 1Password Teams. If your team stores customer passwords here — which most MSPs do — compromise of this system is functionally equivalent to compromise of every customer. The LastPass 2022 breach was specifically devastating to MSPs because so many of them used LastPass as their primary credential vault.

**6. Your documentation system.** Same vault category as above, even if you don't use it for passwords specifically. Network topology, IP ranges, VPN configs, AV exclusions, business-hour windows. Everything an attacker would want to plan a targeted operation against your customers.

**7. Your shared mailboxes — billing, support, alerts.** Often configured with weak authentication ("we share the password among the team"). Often have access to customer-side automation and webhook endpoints. Often missed in MFA enforcement audits.

Each of these is a single-point-of-multiple-customer-failure. Each deserves the level of hardening you would never let a customer skip.

## The MSP's attack surface, by initial-access vector

An attacker targeting your MSP can come at you through any of the methods in lessons 1–6, plus a few specific to the MSP business model:

**Credential stuffing (lesson 1) against MSP staff accounts.** Your techs are humans with the same password-reuse habits as their customers' staff. MFA enforcement on every MSP staff account, including service accounts, is non-negotiable.

**MFA fatigue (lesson 2) against an on-call engineer at 3 AM.** Your on-call engineer is *exactly* the kind of fatigued, distracted, authority-figure-deferring user that fatigue attacks target. The Uber incident hit a contractor at home in the evening; the same playbook against your own staff would work the same way.

**AiTM phishing (lesson 3) targeting MSP admins.** An attacker who's done their homework can craft a phishing email specifically for an MSP admin — pretexts like "Microsoft Partner Center authorisation review" or "Customer Compliance Alert" land harder when the target's job is precisely this kind of work.

**OAuth consent phishing (lesson 4) against MSP staff.** A malicious "PSA Productivity Plus" app sent to your techs. Some of them will consent. Then the attacker has read access to mailboxes that contain customer credentials and customer escalation patterns.

**Device-code phishing (lesson 5) via a "demo meeting".** Recent Storm-2372 campaigns have specifically targeted IT-services companies, which is to say *MSPs*. The pretext often involves a vendor demo or a Microsoft Partner program touch-point.

**Software supply chain.** Like Kaseya. Compromise of a tool you use → compromise of you → compromise of your customers. Defence here is largely outside your control (you're at the mercy of your vendors), but the operational responses — segmenting RMM access, requiring MFA on all RMM logins, monitoring RMM activity logs — are within your control.

**Phishing of your customers' staff that then asks for MSP access.** Less direct but increasingly common: attacker compromises an end-customer user, then poses as that user to send an email to your help desk requesting password resets, group memberships, or app installations. Your help desk needs verification procedures that don't just trust email.

## Hardening the MSP — the actual checklist

This is the practical core of the lesson. Read it once, then audit your own MSP against it.

**Identity and authentication:**

1. **Every MSP staff account on phishing-resistant MFA.** Passkeys or FIDO2 keys. No exceptions for "convenience." Lesson 3 explained why; if you have not done this for your own organisation by mid-2026, you are on borrowed time.
2. **Conditional Access policies on the MSP's tenant**, requiring compliant device for all access to admin portals and to any tenant management surfaces. The same controls you set on customer tenants — applied to yourself.
3. **Block device code flow** for all but documented service accounts. Storm-2372 has been specifically targeting IT services since 2024. The CA policy from lesson 5 applies inside your own tenant first.
4. **Privileged Identity Management (PIM) for Global Admin and other privileged roles**, if you're on E5. Just-in-time elevation, not permanent assignment. If you're not on E5, *you should be* — the MSP is exactly the kind of customer that justifies E5 because the security stakes are higher than they would be for the typical SMB.
5. **Break-glass accounts with FIDO2 keys stored physically** (not in your password manager). Two of them, separated. Audited. Tested quarterly. Documented who has access.

**Tooling and credentials:**

6. **MFA on every MSP-side tool**: RMM, PSA, credential vault, documentation system, any backup or DR tool, monitoring tools, the Microsoft Partner Center, your domain registrar, your DNS provider, your hosting provider, your code repository if you have one. Anywhere the attacker can get into and pivot.
7. **Credential vault hygiene.** Every secret stored has an owner, a creation date, and a rotation policy. Customer passwords stored only when they have to be (and even then, with per-customer access controls). The vault itself has FIDO2-required MFA and audit logging. If your vault is a wiki page, fix that this week.
8. **RMM access segmented by customer or customer-group.** An average tech does not need master credentials to every customer's RMM. Restrict the blast radius. Most modern RMMs support per-customer role assignment.
9. **PSA access tied to job role.** Helpdesk staff don't need access to billing data; billing staff don't need access to remote-management tools. The same RBAC discipline you've been applying to customer tenants applies inside your own organisation.

**Partner Center and customer access:**

10. **GDAP relationships scoped to least privilege.** When you set up a GDAP relationship with a customer, you can choose which roles you receive. Don't take Global Admin if you only need Helpdesk Admin. The over-broad GDAP relationships are what turn an MSP compromise into a customer compromise.
11. **GDAP relationships expire.** Set realistic expirations (often 2 years maximum, less if the customer is sensitive). Renew explicitly.
12. **Customer-side delegated-admin notifications.** Make sure each customer is notified when GDAP roles are assigned, used, or modified. The customer's tenant logs show GDAP activity; their security team should be subscribing to the alerts.

**Detection and monitoring:**

13. **Your own MSP tenant runs Panoptica365.** Yes, this sounds self-serving in a Panoptica365 curriculum, but the point is broader: every tool, every detection capability, every alert pipeline you sell to your customers should be running first against your own tenant. Eat your own dog food.
14. **Defender XDR Attack Disruption enabled** on the MSP tenant, with the same posture you apply to customers. If anything, the MSP tenant should have *more* sensitive Disruption thresholds than the average customer.
15. **Audit logs retained longer than the default.** 90 days isn't enough for an MSP. Extend mailbox auditing to a year. If you can afford Sentinel, log everything for two years.
16. **Quarterly review of OAuth grants in the MSP tenant.** Same review you should be doing for customers, applied to yourself. Remove anything you don't recognise.

**Incident response readiness:**

17. **A written incident-response plan for the MSP itself.** Not just "what we do when a customer gets compromised." What happens if *we* get compromised. Who decides to notify customers; what the legal obligation is; how cyber insurance is engaged; what the customer-communication plan is in the first 24 hours; whether the MSP keeps operating or pauses to investigate.
18. **Cyber insurance specifically covering MSP / supply-chain risk.** Generic small-business cyber insurance often excludes downstream-customer losses. MSP-specific policies (Coalition, At-Bay, Resilience, others) explicitly cover this scenario. Read your policy.
19. **Tabletop exercises with the leadership team.** Not just IT. Run a "what if our RMM gets compromised tonight" exercise once a year. The first time you have to make those decisions should not be when it's real.
20. **Customer communication plan.** Most MSPs don't have a pre-written customer-notification template for "we've been breached." Write one. Have it lawyer-reviewed. Have your insurance carrier review it.

## The honest acknowledgement

Some of the items above are uncomfortable. Some are expensive. Some require organisational changes inside the MSP that don't ladder up to billable hours. The conversation with your own leadership team about *why we have to spend money on our own security* is one of the harder conversations in this industry, because the immediate revenue benefit is zero.

The argument is the same one you make to customers: the cost of *not* doing this, when the incident happens, is multiplicative. An MSP that suffers a public supply-chain compromise loses customers, gets sued, pays out of pocket for incident response, often goes out of business. The post-Kaseya MSP landscape included multiple MSPs that simply did not survive — not because they were destroyed by the attack itself, but because they couldn't rebuild customer trust in time to keep the lights on.

Your MSP's security is your business continuity. Treat it accordingly.

## What this means for the operator

Three takeaways specifically for you, the person reading this inside your own MSP:

**The same controls you sell to customers should be running inside your MSP first.** Phishing-resistant MFA, Conditional Access, Token Protection, PIM, audit logging. If your customers have it and you don't, you have inverted the security posture exactly backwards.

**GDAP scope is one of the highest-leverage controls in your business.** When you renew or set up GDAP relationships, take only the roles you need. Most MSPs over-grant out of convenience. Tightening this is the difference between "an attacker who compromises one of our admins can read mail in 30 customer tenants" and "an attacker who compromises one of our admins can read mail in 30 customer tenants *and* deploy ransomware to 30 customer endpoint estates."

**Document your own incident-response plan before you need it.** When the MSP itself is the target and something is going wrong at 2 AM, the team that thrives is the team that has practiced the response. The team that improvises in the moment is the team that ends up on a podcast as the cautionary tale.

## Closing card 2

You've now seen six attack patterns plus the meta-pattern of how those attacks apply to the MSP itself. By the end of this card, every alert in your Panoptica365 queue should map to one of these seven mental models:

1. *Boring* — credential stuffing or password spray.
2. *Social* — MFA fatigue.
3. *Technical* — AiTM phishing.
4. *Persistent* — OAuth consent phishing.
5. *Sneaky* — device-code abuse.
6. *Money* — business email compromise.
7. *Multiplier* — the MSP supply-chain attack that turns any of the above into all of the customers simultaneously.

When a new alert lands, your first move is to classify it. Once you've classified it, the response playbook from the corresponding lesson kicks in.

The next three cards (Conditional Access, Intune, Email Hardening) shift from threat narrative to control configuration — how to build the defences that prevent these attacks, in detail. Then card 6 (Secure Score) gives you the measurement layer. After that, Panoptica365 itself becomes the daily operational surface that surfaces the attacks above as they happen, in your own MSP and across your customers' tenants.

For now: the MSP is the target. Protect it like you would protect your largest customer, because if you fail at that, you've failed every customer at once.

---

*Sources for the data points in this lesson — Kaseya VSA supply-chain ransomware attack ([CISA — Kaseya VSA Supply-Chain Ransomware Attack guidance](https://www.cisa.gov/news-events/news/kaseya-ransomware-attack-guidance-affected-msps-and-their-customers)); Kaseya incident scale and REvil attribution ([Wikipedia — Kaseya VSA ransomware attack](https://en.wikipedia.org/wiki/Kaseya_VSA_ransomware_attack)); Five Eyes joint advisory on MSP targeting ([CISA — Joint advisory on cyber threats to MSPs](https://www.cisa.gov/news-events/cybersecurity-advisories/aa22-131a)); Microsoft GDAP technical reference ([Microsoft Learn — Granular Delegated Admin Privileges](https://learn.microsoft.com/en-us/partner-center/gdap-introduction)); MSP-targeted ransomware trends 2024-2025 ([The Record — Cyberattacks on MSPs warning](https://therecord.media/managed-service-providers-cyberattacks-warning-five-eyes)).*
