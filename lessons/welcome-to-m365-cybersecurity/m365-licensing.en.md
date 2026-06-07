---
title: "Microsoft 365 licensing — what unlocks what"
subtitle: "From Business Basic to E5 — which SKU tier unlocks Conditional Access, Intune, Defender for Endpoint, and risk-based identity protection."
icon: "key"
last_updated: 2026-05-29
---

# Microsoft 365 licensing — what unlocks what

Microsoft's licensing strategy can be summarised in one sentence: *get more customers to Business Premium or E5*.

Once you see the strategy, the entire licence catalogue starts making sense. Why does Business Standard remain conspicuously underpowered on security? Because Microsoft wants Standard customers to upgrade to Premium. Why does E3 keep getting new features added at every price hike? Because Microsoft wants to make E3 the obvious step between Premium and E5. Why does E5 keep the most interesting Defender capabilities locked behind it? Because that's where the margin lives.

I am telling you this up front because licensing decisions are the single most leveraged conversation an MSP has with a customer. Get the tier right and most of the controls in this curriculum just work. Get it wrong — leave a customer on Business Standard, for example — and roughly half of what you've learned in cards 2 through 6 becomes inaccessible, no matter how hard you try.

This lesson is the licence map, an honest take on each tier, and how to use the tier in customer conversations.

## The current price card (effective July 2026)

Microsoft just raised prices across most tiers. Annual-commitment pricing, per user, per month, in USD:

| Tier | Price (post-July 2026) | Previous price |
|---|---|---|
| Business Basic | ~$6 | ~$6 (flat) |
| Business Standard | $14 | $12.50 |
| **Business Premium** | **$22** | **$22 (flat)** |
| Microsoft 365 E3 | $39 | $36 |
| Microsoft 365 E5 | $60 | $57 |

Notice what Microsoft did. **Business Premium did not go up.** Business Standard went up 12%. E3 and E5 went up 8% and 5% respectively. The Premium price hold is not generosity; it is a signal. They want Standard customers to find Premium even more attractive, and they have just added a meaningful list of capabilities to Premium and E3 at the same time. The pricing *is* the marketing.

## What each tier actually unlocks (security only)

The full feature matrix is sprawling. Below is the security-only slice — the parts that matter for the curriculum you're reading.

### Business Basic — ~$6/user/mo

Email and the Office web apps. **Exchange Online Protection (EOP)** for anti-spam and basic anti-malware on mail flow. No Conditional Access. No MFA enforcement at the licence level (you can still enable security defaults, but those are blunt). No Intune. No Defender beyond EOP.

In security terms, Business Basic is "M365 is technically present." If a customer is on this tier and you're responsible for their security, you're *protecting them with the tools they own*, which is to say almost none.

### Business Standard — $14/user/mo (post-July 2026)

Adds the desktop Office apps and a few business features (Bookings, Forms, MileIQ). On the security side, **identical to Basic.** No Intune. No Defender for Business. No Entra ID P1. No Conditional Access.

This is the trap tier. Customers think they're "on Office 365" and assume that includes security. It does not. Standard customers cannot use Conditional Access, cannot manage devices through Intune, cannot apply meaningful anti-phishing beyond the EOP baseline. If a customer is at Standard and an attacker phishes them, your response options are limited to "reset their password" — which we already established (lesson 1, card 2) is not enough in 2026.

### Business Premium — $22/user/mo

The first tier with real security tools, and the most important tier in this entire lesson.

- **Intune Plan 1** — full device management, compliance policies, app deployment.
- **Defender for Business** — SMB-focused EDR with simplified policy management. Less capable than Defender for Endpoint Plan 2, but covers the threat model for most SMBs.
- **Entra ID P1** — *Conditional Access*, plus self-service password reset, dynamic groups, group-based licensing.
- **Defender for Office 365 Plan 1** — anti-phishing policies, Safe Links, Safe Attachments, impersonation protection. (Added to Premium and E3 in late 2025.)
- **Information Protection P1** — sensitivity labels (manual classification).
- **Microsoft Purview compliance** — basic retention and eDiscovery (limited).

Business Premium is the **SMB security baseline**. It is the lowest tier where the controls in this curriculum are mostly usable. If a customer has fewer than 300 users and is on anything below Premium, your first conversation with them should be about moving up. Premium is also a price-fixed tier — Microsoft is leaving it at $22 specifically to make this conversation easier.

The two notable gaps in Premium that operators feel:

**No Entra ID P2.** P2 is where Identity Protection (risk-based scoring of users and sign-ins) lives. Risk-based Conditional Access — "block sign-in when user risk is high" — is not available in Premium. You can require MFA across the board, but you cannot dynamically escalate based on Microsoft's own risk telemetry.

**No full Defender XDR.** Defender for Business gives you EDR for endpoints but is not the same as Defender for Endpoint Plan 2, and many of Defender XDR's deeper cross-product correlation capabilities (Threat Explorer, Custom Detection Rules at scale, advanced hunting with long retention) are Plan-2 / E5 features.

For 80% of SMB customers, those gaps don't matter day-to-day. For the other 20% — regulated industries, customers with sensitive data, customers who have already been breached once — they matter a lot.

### Microsoft 365 E3 — $39/user/mo (post-July 2026)

Designed for larger organisations or those who want the full Microsoft stack without the Defender for Endpoint Plan 2 / Entra ID P2 jump to E5. E3 has been getting upgraded steadily — late 2025 added Defender for Office 365 Plan 1 and Intune Plan 2, plus Remote Help and Intune Advanced Analytics.

Compared to Business Premium, E3 adds:

- **Intune Plan 2** — Remote Help, advanced device-management features.
- **Microsoft Defender Antivirus** included (this is the bundled Windows AV — *not* Defender for Endpoint).
- **Office 365 E3 features** — higher mailbox limits, archiving, more advanced compliance.
- **No user cap** — Business Premium is capped at 300 users.

What E3 *doesn't* get you that you might think:

- **Defender for Endpoint Plan 2** (EDR with advanced response actions) — E5 only.
- **Entra ID P2** (Identity Protection) — E5 only.
- **Defender for Identity**, **Defender for Cloud Apps** — E5 only.
- **Full Defender XDR** — partial in E3; full only at E5.

E3 is, somewhat awkwardly, *less secure than Business Premium* on the EDR axis. Business Premium ships Defender for Business; E3 ships only the bundled Windows Defender Antivirus. The right E3 customer pairs their licence with Defender for Endpoint Plan 1 or 2 as an add-on, or steps up to E5.

This is why "E3 vs Business Premium" is a real customer conversation, and not one with a one-line answer. Many SMBs end up better-protected on Premium than on E3 because Premium ships a real EDR by default.

### Microsoft 365 E5 — $60/user/mo (post-July 2026)

The full stack.

- **Defender for Endpoint Plan 2** — the complete EDR with advanced hunting, automatic investigation, six months of telemetry retention, full XDR integration.
- **Defender for Identity** — on-premises AD monitoring.
- **Defender for Cloud Apps** — SaaS-wide monitoring and shadow-IT discovery.
- **Defender for Office 365 Plan 2** — adds Threat Explorer, Attack Simulation Training, Automated Investigation and Response.
- **Entra ID P2** — Identity Protection (risk scoring), Privileged Identity Management (PIM), access reviews.
- **Insider Risk Management** — Purview's data-leak-by-insiders module.
- **Cloud PKI** — Microsoft-hosted certificate authority.
- **Microsoft Security Copilot agents** (rolling out 2026) — AI-driven security workflow assistance across Defender, Entra, Intune, Purview.

E5 is correct for customers who have a real security team, regulated workloads, or who have asked their MSP to "be the SOC." Most SMBs do not need E5; some absolutely do.

## When E5 is actually worth it

The honest E5 pitch is not "more features for more money." It's *three specific capabilities that are not available below E5*.

**Risk-based Conditional Access.** Entra ID P2 (E5 only) gives Conditional Access the ability to read user risk and sign-in risk from Entra ID Protection at policy time. This means you can write "block sign-in when user risk is high" instead of "require MFA always." It's the difference between blunt-instrument MFA and contextual security. For customers who frequently see sophisticated identity attacks, this matters.

**Defender for Endpoint Plan 2.** The full EDR. Behavioural-detection coverage in Plan 2 is materially deeper than Defender for Business (Premium) or Defender Antivirus alone (E3). Includes Live Response (remote shell into a device for investigation), full Threat & Vulnerability Management, six months of telemetry retention.

**Privileged Identity Management (PIM).** Just-in-time admin elevation. Admins don't have permanent Global Admin; they request elevation, approve through workflow, and the role is automatically revoked after a set time. For any customer where insider threat is real (it almost always is), PIM is one of the best mitigations available and exists only at E5.

If a customer doesn't benefit from at least two of those three, E5 is probably overkill. Sell them Business Premium with a clean explanation of *why* — that's a more honest pitch than upgrading them for revenue reasons.

## What the July 2026 price hike means for customer conversations

You will be having pricing conversations with most of your customers in the next 6–9 months. A few things to keep in mind.

**The price differential between Standard and Premium just shrank.** Premium is $22, Standard is $14. The gap was $9.50; it's now $8. The argument for upgrading customers from Standard to Premium got 16% cheaper to make. Use that.

**E3-only customers should be evaluated for upgrade pressure.** E3 customers paying $39 are spending nearly twice what Premium costs but are getting *less EDR coverage* on their endpoints. Many should either step down to Premium (if under 300 users) or step up to E5. Sitting on E3 without Defender for Endpoint Plan 2 as an add-on is a security middle ground that should be revisited.

**E5 is now a $60 customer.** Renewal conversations at $60 are different from $57. Make sure the customer is actually *using* enough of the E5 stack to justify it — PIM enabled and configured? Identity Protection actually feeding risk-based CA policies? Defender XDR being reviewed weekly? If three of those answers are "no," the customer may be paying for capabilities they aren't operating, and you have a conversation about either right-sizing their licence *or* helping them operate what they own.

## What this means for the operator

Two practical takeaways.

**Know the licence tier before you propose a control.** "Enable risk-based Conditional Access" is a great recommendation, except it doesn't exist below E5. Recommending controls the customer doesn't have access to is a credibility problem. Panoptica365's licence-awareness in alerts (the AI-analysis layer) is partly about preventing this — but you, the operator, should also internalise which controls require which tier.

**The licence conversation is part of the security conversation.** MSPs who treat licence-tier as a sales question and security as a separate technical question miss this. The licence *is* the security boundary. If you cannot enable Conditional Access, you cannot enforce identity boundaries. If you cannot deploy Defender for Endpoint, you cannot meaningfully respond to ransomware. Selling Business Premium is selling security; selling Business Standard is selling a different product than the customer thinks they're buying.

## What's next

- **Lesson 6: Where Panoptica365 sits in this picture.** The final orientation lesson before we get into the actual threats and controls.

Then card 2 (*Identity Threats & Attack Patterns*) starts. By that point, when an alert recommends "phishing-resistant MFA" or "risk-based CA" or "Defender for Identity," you'll know whether the customer can act on that recommendation or whether the recommendation itself is a licence-upgrade conversation in disguise.

For now: licences are not a billing detail. They're the security boundary. Sell Business Premium. Treat Standard like a security gap. Treat E5 like a justified expense only when the customer is actually using its three differentiated capabilities.

---

*Sources for the data points in this lesson — Microsoft 365 pricing and feature changes effective July 2026 ([Microsoft 365 Blog — Advancing Microsoft 365, December 2025](https://www.microsoft.com/en-us/microsoft-365/blog/2025/12/04/advancing-microsoft-365-new-capabilities-and-pricing-update/)); Microsoft 365 plan comparison and feature matrices ([Compare Microsoft 365 Enterprise Plans and Pricing](https://www.microsoft.com/en-us/microsoft-365/enterprise/microsoft-365-plans-and-pricing)); Business Premium vs E3 analysis ([TrustedTech — Business Premium or E3?](https://www.trustedtechteam.com/blogs/microsoft-365/business-premium-vs-e3)); Microsoft 365 2026 pricing changes summary ([CloudCapsule 2026 pricing analysis](https://blog.cloudcapsule.io/blog/microsoft-365-pricing-changes-in-2026-what-you-really-need-to-know)).*
