---
title: "Secure Score 101 — what the number actually measures, and what it doesn't"
subtitle: "Understand what Microsoft Secure Score measures, what it misses, and how to use it honestly in customer conversations."
icon: "gauge"
last_updated: 2026-05-29
---

# Secure Score 101 — what the number actually measures, and what it doesn't

An MSP onboards a new customer in March. The customer's previous IT provider had spent the last two years assuring them that their Microsoft 365 environment was "fully secured" — that pitch had been part of the renewal proposal that kept the previous provider in place for those two years. The customer believed it. The new MSP, taking over the account, opens Panoptica365, adds the tenant, lets the polling complete. The Secure Score comes back at **41%**.

The new MSP shows the customer. The customer is, briefly, very angry — at the previous provider, at themselves for not asking earlier, at the situation. Once the immediate reaction passes, they ask the question that every customer asks: "what does that number actually mean?"

This lesson is about being able to answer that question honestly. Microsoft Secure Score is the most-cited security metric in the M365 ecosystem and one of the most-misunderstood. Operators who can read it correctly — who know what the percentage measures, what it doesn't, where it agrees with reality, and where it misleads — can use it as one of the most powerful customer-facing tools in the MSP toolkit. Operators who treat it as a black box either underestimate it (ignoring a useful signal) or overestimate it (selling a percentage instead of selling actual security work).

Card 6 is six lessons about reading Secure Score honestly, mapping our curriculum to it, knowing where it lies, and using it as a customer-facing deliverable that justifies the service line.

## What Microsoft Secure Score actually is

Microsoft Secure Score is a tenant-wide security posture metric that Microsoft calculates daily for every M365 tenant. It expresses, as a percentage, how many of Microsoft's recommended security configurations the tenant has implemented relative to the total possible.

The basics:

- **The number is a percentage**, computed as `(points earned) / (max points available) × 100`. A customer with 988.2 points out of a possible 1113.0 has a Secure Score of approximately 88.79%.
- **Microsoft calculates the score daily** based on tenant configuration. You don't have to opt in; every M365 tenant has a Secure Score.
- **The score covers a defined set of recommendations.** Each recommendation has a maximum point value Microsoft assigns based on its assessment of the recommendation's security impact. Implementing a recommendation earns the points (or a fraction, for partial credit).
- **Recommendations are organised into categories** — typically Identity, Devices, Apps, Data. The breakdown lets you see which areas of the tenant are strong and which are weak.
- **Microsoft publishes industry comparisons** — the "average score for organisations of similar size." A tenant with 88.79% might be compared against a similar-size-organization average of 46.74%, which is the kind of comparison that turns the number into a renewal-conversation visual.

The score lives in the **Microsoft 365 Defender portal** (`security.microsoft.com` → Secure Score). That's the canonical and effectively only Microsoft surface for the headline Microsoft Secure Score. For MSP operators, the portal is per-tenant — each customer requires opening their tenant individually. Cross-tenant aggregation is not something Microsoft natively provides; that's where Panoptica365's view (covered in lesson 5) becomes a meaningful operator surface.

## What recommendations look like

A recommendation in Secure Score has a few moving parts:

- **A title** describing what to do (e.g., "Require MFA for administrative roles", "Ensure mailbox auditing is enabled for all users", "Enable BitLocker for OS drives").
- **A category** (Identity, Devices, Apps, Data).
- **A maximum point value** — how many points the recommendation contributes if fully implemented.
- **The current points earned** — zero if not implemented, the maximum if fully implemented, or somewhere in between for partial credit (covered in lesson 2).
- **A license requirement** — some recommendations only apply if the tenant has specific licensing (e.g., Entra P2, Defender for Endpoint, E5 features). Recommendations the tenant isn't licensed for don't count against the max.
- **An action** — the link or instructions to actually implement the recommendation, often deep-linked into the relevant Microsoft portal.

When operators look at a tenant's Secure Score in the portal, what they see is essentially a ranked list of recommendations, sortable by category or by point value, with implementation status visible per recommendation. The work of moving the score is the work of going down that list, implementing the high-value items first, and accepting that some items won't apply to every customer.

## The Identity Secure Score — the Entra cousin worth knowing about

There's a second metric called **Identity Secure Score** that lives in Entra ID and gets confused with Microsoft Secure Score on a regular basis. Operators should know the distinction.

- **Microsoft Secure Score** — tenant-wide, covers Identity / Devices / Apps / Data. The thing this lesson is about. Lives in the Defender portal.
- **Identity Secure Score** — Entra-specific, covers only identity-related recommendations. Lives in the Entra admin centre. Has a separate scoring methodology focused exclusively on Entra ID security posture.

The two scores overlap (both include identity recommendations) but are calculated differently and surface in different portals. The Microsoft Secure Score is the more comprehensive metric and the one to use for customer-facing conversations. The Identity Secure Score is occasionally useful for drilling into the identity-specific picture but isn't the headline number.

When a customer asks "what's our security score?" they almost always mean Microsoft Secure Score. If you find yourself looking at a different number than you expected, check which portal you're in — Entra and Defender both show "Secure Score" without always making it obvious which one.

## What the score does NOT tell you

This is the framing that matters more than the definition. The score is **useful but limited**. Operators who understand the limits use it well; operators who don't either oversell it to customers (creating expectations the score can't meet) or dismiss it (missing what it does usefully signal).

What the percentage does *not* measure:

- **Whether the tenant has been attacked or compromised.** A 95% score on a tenant that's currently being silently exfiltrated by an AiTM-equipped attacker is still a 95% score until Microsoft's detections fire. The score is a configuration snapshot, not a threat status.
- **Whether the configured settings are *well-tuned* for the customer.** Secure Score awards points for "anti-phishing policy enabled" — it doesn't know whether the protected-users list contains the right people, whether the trusted-senders list has been kept current, whether the policy thresholds match the customer's actual risk profile. Two customers with identical Secure Scores can have wildly different real-world phishing protection depending on the per-customer tuning underneath.
- **Operational discipline.** The drift detection, alert triage, exception management, annual review — none of that ongoing work is reflected in the score. A customer whose MSP set everything up correctly two years ago and then ignored the account has the same score as a customer whose MSP responds to drift alerts within hours.
- **Recommendations that aren't in Microsoft's list.** DMARC publication (the DNS-side work from Card 5 lesson 4) isn't scored — Microsoft can't reliably verify external DNS records, so the entire `p=none → p=quarantine → p=reject` journey doesn't show up. SPF publication is similarly unscored. Mail flow rule hygiene, customer-specific exemption ledgers, security awareness training, off-platform incident response — none of this is measured.
- **The customer's actual threat landscape.** A small accounting firm and a large law firm can have identical Secure Scores while facing entirely different threat profiles. The score is a generic baseline against Microsoft's idea of "what every M365 tenant should do," not a tailored risk assessment.
- **Whether what's *configured* matches what's *enforced*.** Secure Score reads configuration. It doesn't independently verify that the configuration is actually doing what it's supposed to do at runtime.

The list could go on. The point is not to be cynical about the metric — it's genuinely useful. The point is to be honest with yourself and with customers about what the percentage signals and what it doesn't.

## Why the score is still worth using

Despite the limits, Microsoft Secure Score earns its place in the MSP toolkit for three specific reasons:

**It's a quantifiable number.** Customers respond to numbers. "Your security posture has improved" is vague; "your Secure Score went from 62% to 84% in nine months" is concrete and presentable in a renewal meeting.

**It's third-party-authored.** Microsoft defines the recommendations and assigns the weights. The MSP isn't grading their own homework — they're being graded against a baseline Microsoft maintains. That third-party credibility matters when customers wonder whether the MSP is just inventing metrics that make themselves look good.

**It's directionally honest at the floor.** A tenant at 41% has serious recommendations untouched. A tenant at 88% has done most of what Microsoft recommends. The score's accuracy degrades at the high end (the difference between 88% and 95% can be license-gated recommendations or items that don't apply), but at the low end it's reliable as a "this customer is undermanaged" signal.

The new MSP from the opening anecdote uses the 41% number to anchor the customer conversation. Not "your previous provider lied" (too confrontational, plus the previous provider may have genuinely believed their work was adequate), but "here's the baseline measurement; here's what's behind it; here's the plan to bring it up." Within nine months that score is at 82%. The customer renews. The Secure Score was the metric that made the work visible.

## What this means for the operator

Three takeaways.

**Secure Score is a configuration snapshot, not a security guarantee.** A high score doesn't mean safe; a low score doesn't mean compromised. Treat it as a useful posture indicator, not a verdict. When customers ask "are we secure?", the score is part of the answer, never the whole answer.

**The Identity Secure Score is a separate metric in a different portal.** Don't confuse the two in customer conversations. Microsoft Secure Score is the headline; Identity Secure Score is the drill-down for identity-specific work.

**The score's most powerful use is the trend over time.** A single Secure Score percentage is a number. A Secure Score that's moved from 41% to 82% over nine months is a story — and stories are what customers remember at renewal. The work of Cards 3, 4, and 5 directly drives that movement; the rest of Card 6 is about reading it correctly and using it well.

## What's next

- **Lesson 2: How the score is calculated.** The mechanics under the percentage — points, weights, partial credit, license-gating, and why the score moves on its own without you changing anything.
- **Lesson 3: Mapping the curriculum to the score.** How the work from Cards 3, 4, and 5 translates into specific Secure Score recommendations, and the high-leverage half-dozen that move the score most.

For now: open Panoptica365's main dashboard. Look at the Secure Score column across your customer tenants. Notice the range — some are in the 80s, some lower, the lowest is the one that needs the conversation soonest. Click into the lowest. The score has a story. The rest of card 6 is about reading and telling it.

---

*Sources for the data points in this lesson — Microsoft Learn on Microsoft Secure Score overview ([Microsoft Learn — Microsoft Secure Score](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score)); Secure Score calculation methodology ([Microsoft Learn — How Secure Score is calculated](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions)); Identity Secure Score overview ([Microsoft Learn — Identity Secure Score in Entra ID](https://learn.microsoft.com/en-us/entra/fundamentals/identity-secure-score)); industry-comparison reference for similar-size organisation averaging ([Microsoft Learn — Secure Score comparisons](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-history-metrics-trends)); recommendation categories and license-gated scoring ([Microsoft Learn — Secure Score data](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-required-permissions)).*
