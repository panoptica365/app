---
title: "Operating Secure Score at scale — and closing the curriculum"
subtitle: "How to manage Secure Score across a full MSP book of business using Panoptica365 — fleet visibility, quarterly cadence, and the year-end story."
icon: "trending-up"
last_updated: 2026-05-29
---

# Operating Secure Score at scale — and closing the curriculum

An MSP's Q4 team meeting. The owner pulls up Panoptica365's main console dashboard and walks the team through the year's numbers. Average Secure Score across all 28 managed tenants moved from **71% in January to 84% in December**. Five tenants crossed 90%. The lowest-scoring tenant — a customer onboarded in September from a previous provider — is now at 67%, up from a baseline of 38%. Zero major security incidents across the book. Two new customer wins came from referrals where the existing customer's CFO had specifically praised the MSP's "professional security work" in a CEO-to-CEO conversation.

The team's conversation isn't about heroics. Nobody had a dramatic incident-response week. Nothing on fire. The year's results came from the unglamorous discipline of: deploying the templates from Cards 3, 4, and 5; responding to drift alerts as they fired; running quarterly reviews per customer; documenting exceptions; declining the temptation to chase 100% scores. The work was steady and procedural and produced exactly the kind of measurable outcome MSPs build their businesses on.

This is what the curriculum is for. Lesson 6 closes Card 6 — and the curriculum — by walking through the quarterly review cadence that turns the work into a sustainable practice, the 80%+ target that defines what "good enough" looks like, and the closing argument for why this discipline is the renewal-and-referral engine MSPs need.

## The quarterly review cadence

Every customer, every quarter — synchronised with the customer's business cadence or your renewal calendar, whichever drives the timing. A worked 90-minute review per customer:

**1. Verify the Secure Score and the underlying trajectory (10 minutes).** Open Panoptica365's customer dashboard for the tenant. Look at the Secure Score tile. Compare to the previous quarter's number from your customer documentation. Note any unexpected movement — both directions matter.

- Score moved up significantly: confirm the work that caused it (template deployment, recommendation implementation). Document the cause in the customer's notes.
- Score moved down: investigate. The diagnostic flow from lesson 2 applies — was it a MDVM vulnerability detection that should resolve when patching catches up, a Microsoft-added recommendation, license change, or a real tenant-side regression that needs action?
- Score moved flat: confirm this is steady-state for a customer near their license ceiling, not stagnation that should be addressed.

**2. Review new recommendations Microsoft added since last quarter (20 minutes).** Open the Defender portal for the customer. Look at the History tab. For each new recommendation Microsoft added:

- **Implement** if it's low-friction and high-value (most are).
- **Plan** if it's high-value but needs scheduling (an Intune template deployment, a CA policy adjustment that needs a maintenance window).
- **Risk Accept** if it doesn't fit the customer (license not present, business model doesn't apply, third-party tool handles it differently).
- **Resolved through third party** if a non-Microsoft tool genuinely covers the function — honestly, not as score-gaming.

Document each decision in the customer's exception ledger (the discipline from Card 5 lesson 10). Future-you will appreciate the record.

**3. Audit Risk Accepted items (15 minutes).** For each previously Risk Accepted recommendation, confirm the reasoning still holds. License hasn't changed? Customer's risk profile hasn't shifted? Third-party tool still in place? Things change quietly — an annual sweep catches the items whose justification quietly expired.

**4. Review drift alert resolution from the quarter (15 minutes).** Pull the alert engine's history for the customer. For each drift alert fired this quarter, confirm:
- The alert was triaged in reasonable time
- The response (Apply / Accept / Investigate) was correctly chosen
- Any accepted drifts have documented reasoning

This is where you catch the patterns — a customer with frequent drift on a specific setting may have an admin doing something undocumented, or may have a configuration that's genuinely ambiguous.

**5. Update the customer exception ledger (15 minutes).** The exception ledger from Card 5 lesson 10 — trusted senders, Remote Domain entries, per-mailbox SMTP AUTH overrides, transport rules, custom quarantine policies — review every entry. For each, ask: is this exception still needed? Is the business reason still valid? Document any decisions to remove.

**6. Plan the next quarter (15 minutes).** Based on the score trajectory, the new recommendations Microsoft added, the unscored work outstanding, and the customer's business priorities — write the next quarter's plan. Two or three specific deliverables. Specific recommendations to implement. Specific exceptions to revisit. Specific customer-facing milestones.

The customer doesn't have to attend the review. It's an MSP-internal exercise. Some customers want a summary; most don't. The output is documentation: notes, the updated exception ledger, the next-quarter plan. By the time the customer's annual renewal rolls around, four quarterly reviews have built a comprehensive record of the year's work.

## The 80%+ target — what "good enough" looks like

For a customer running Microsoft 365 Business Premium with the full ecosystem (Defender for Office, Defender for Endpoint, Intune, Entra ID P1), the target Secure Score is **80% or higher**. Concrete benchmarks:

- **Below 70%:** something specific is missing. The half-dozen from lesson 3 is the diagnostic checklist — work through which items aren't implemented. There's no excuse for a Business Premium customer running the ecosystem to be below 70% twelve months into a competent MSP relationship.
- **70-80%:** mid-deployment customer. Some half-dozen items in place, some not. Or a recently-onboarded customer trending up. The next quarter's work is the remaining half-dozen items.
- **80-88%:** the healthy range. Most of Microsoft's recommendations are implemented; Risk Accepted items are documented; the remaining gap is the long tail (smaller recommendations, license-gated items handled honestly, partial-credit items at high but not full implementation). This is where competent MSP work lands customers.
- **High 80s (87-92%):** exemplary. Everything in the half-dozen is at full credit; most of the long-tail items are handled; the Risk Accepted ledger is well-maintained; the customer's tuning is solid. This is the customer you point at in marketing material and reference in renewal proposals.
- **90%+:** rare and worth scrutinising. Either the customer has unusually clean configuration (small tenant, simple setup, no legacy systems), unusual licensing (E5 with the recommendation set heavily aligned to their environment), or the operator has been creative with Risk Accepted and Resolved through third party. The honest framing in customer conversations: "we're at 92% because of X specific factors; the meaningful security work isn't moving from 92% to 95%, it's the operational discipline that protects the 92%."

A few customers will sit outside this distribution legitimately. A pure E5 customer with deep deployment may genuinely be at 95%+. A customer with extensive legacy commitments may struggle to break 75%. The numbers above describe the *typical* SMB Business Premium customer with a competent MSP — they're the calibration, not the rule.

**Below 80% twelve months into a Panoptica365-managed relationship is a sign of incomplete work, not a feature of the customer's environment.** The half-dozen items move the score reliably. The long tail moves the score incrementally. The operator's job is to keep working both.

## Recognising when to push harder — and when to stop

Not every customer benefits from chasing every point. The judgment about when to push and when to stop is operator craft. Some guidance:

**Push harder when:**
- The half-dozen items aren't all at full credit yet
- There are obvious partial-credit recommendations (one user without MFA, two devices without BitLocker) that one focused hour would resolve
- The customer's renewal is approaching and the trend story needs a visible inflection
- A specific recommendation gates a customer's compliance need (SOC 2, HIPAA, ISO 27001)

**Stop pushing when:**
- The remaining recommendations are E5-only and the customer isn't on E5
- The remaining recommendations would break the customer's legitimate operations (legacy app, marketing platform, etc.)
- You're crossing into gaming territory (lesson 4)
- The marginal points cost more operator time than the customer's renewal value justifies
- The customer's actual risk profile is being addressed by the unscored work (DMARC enforcement, vendor email hygiene, training) and the additional score points wouldn't change their security posture

The instinct to "complete the homework" is strong — operators are wired to chase 100% even when it doesn't help. The discipline is recognising when the work has stopped paying back.

## The closing argument — what this curriculum builds

You've worked through six cards:

1. **Welcome to M365 cybersecurity** — the landscape, the surfaces Microsoft secures, how the ecosystem fits together, where Panoptica365 sits in it.
2. **Identity threats and attack patterns** — what attackers actually do. AiTM, MFA fatigue, OAuth phishing, BEC, MSP-as-target, the rest.
3. **Conditional Access template policies** — the identity-side defence. MFA for all users, block legacy auth, compliant-device requirements, admin hardening, the 9 templates Panoptica365 ships.
4. **Intune template settings** — the device-side defence. Compliance policies, BitLocker, ASR rules, Defender for Endpoint, the 14 templates Panoptica365 ships.
5. **Email security settings** — the email-side defence. Anti-phishing impersonation, Safe Links / Safe Attachments, SPF / DKIM / DMARC, auto-forwarding controls, mailbox auditing, the seven monitored security settings.
6. **Secure Score** — the measurement layer over everything in cards 3, 4, and 5.

End to end, the curriculum describes what good MSP M365 security looks like in 2026. The work is not glamorous. It's not heroic incident response or zero-day exploitation. It's:

- Deploying the templates that move customers from default-Microsoft to Microsoft-recommended baseline
- Responding to drift alerts within reasonable windows so the deployed configurations stay deployed
- Auditing exceptions periodically so the customer's configuration doesn't accumulate untracked drift
- Watching for the post-compromise indicators (inbox rules, transport rules, suspicious sign-ins) and acting on them inside the window that matters
- Doing the unscored work — DMARC enforcement, vendor email hygiene awareness, customer training discussions, incident response runbook maintenance — that the Secure Score never sees but the customer's actual safety depends on
- Communicating the result to customers in language they understand, anchored on numbers that make the work visible

Customers managed this way don't get BEC'd. They don't get ransomware. Their executives' identities don't get cloned. Their controllers don't wire $94,000 to Romanian mules. Not because the MSP guarantees these outcomes — no MSP can guarantee these outcomes — but because the layered defences, applied with discipline, push the customer out of the easy-target population and into the population attackers move past.

That's what the renewal proposal says, even when it doesn't say it. That's what the CFO's referral conversation conveys. That's the renewal-and-referral engine.

The Secure Score is the metric you put on the slide. The curriculum is the work behind it.

## What this means for the operator

Three final takeaways.

**The quarterly review cadence is the operating rhythm.** Every customer, every quarter, 90 focused minutes. Verify the trend, work the new recommendations, audit Risk Accepted, review drift alert resolution, update the exception ledger, plan the next quarter. Without this rhythm, customers drift; with it, customers improve.

**80%+ on Business Premium with the full ecosystem is the target you can defend.** Below 80% twelve months in means specific known recommendations aren't deployed — fix that. 80-88% is the healthy zone. High 80s is exemplary. 90%+ is rare and worth scrutinising for legitimacy. 100% is not a goal; chasing it is gaming.

**The curriculum is the work; the score is the result.** What you spend your time on is the half-dozen and the long tail and the unscored discipline. What customers see is the percentage. Both matter, in that order. The MSPs who internalise the curriculum and apply it with discipline build the security practices that win at renewal and earn referrals. The MSPs who chase the score directly don't.

## Closing the curriculum

You've reached the end. Six cards covering identity, devices, email, attacks, configurations, and measurement. Whether you read straight through or jumped to specific lessons as customer situations demanded — the curriculum is now available as a reference. Come back to it when a specific question surfaces: "what does Card 5 lesson 4 say about DMARC enforcement?" "what's the right anti-phishing trusted-senders pattern?" "what should this customer's Secure Score actually be?"

The lessons stay current as Microsoft and Panoptica365 evolve. Specifics may shift; the architecture and discipline don't. The cards remain the spine of how a competent MSP runs M365 security in 2026.

The renewal meeting you have next month — for the customer you onboarded fourteen months ago — gets opened with the Secure Score trajectory. The customer signs. They refer their sister company. You build the security practice your competitors don't quite manage. The work isn't dramatic. It just compounds.

That's the curriculum. Go run it.

---

*Sources for the data points in this lesson — Microsoft Learn on Secure Score recommendations and quarterly review patterns ([Microsoft Learn — Microsoft Secure Score](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score)); recommendation completion status options ([Microsoft Learn — Track recommendation completion](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions)); Microsoft 365 Business Premium feature overview for the target-tier framing ([Microsoft Learn — Business Premium](https://learn.microsoft.com/en-us/microsoft-365/business-premium/)); MSP renewal and customer-facing reporting context (CISA — Cybersecurity Performance Goals for SMBs) ([CISA — CPGs](https://www.cisa.gov/cross-sector-cybersecurity-performance-goals)); historical context on M365 attack patterns and the operational realities of defence at SMB scale ([Microsoft Security blog — Defender Threat Intelligence](https://www.microsoft.com/en-us/security/blog/topic/threat-intelligence/)).*
