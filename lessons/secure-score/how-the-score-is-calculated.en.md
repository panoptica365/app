---
title: "How the score is calculated — points, partial credit, and why it moves on its own"
subtitle: "The math behind the percentage: how points, partial credit, license-gating, and Microsoft's own changes make the score move."
icon: "calculator"
last_updated: 2026-05-29
---

# How the score is calculated — points, partial credit, and why it moves on its own

An operator opens Panoptica365 on a Monday morning. The previous Friday she'd had Customer X at exactly 88.79%. This morning the same customer reads 86.94%. Nothing changed at the customer over the weekend — no new mailboxes, no policy edits, no admin activity at all according to the Tenant Change Log. The customer's Secure Score dropped by almost two points without anyone touching anything.

She's seen this before. It's the most common Secure Score puzzle operators encounter, and the answer is almost always something on Microsoft's side. They added a new recommendation, they changed how an existing one is scored, they retired one and the math shifted, a license-gated feature became available and the achievable maximum moved — or, most frequently for customers running Defender for Endpoint, a new vulnerability was detected in software installed on a managed device, dropping the score until patches get applied.

The Secure Score is not a static measurement of the tenant. It's a *moving target* — Microsoft's recommendation set evolves continuously, the tenant's licensing state changes occasionally, and the math underneath the percentage shifts accordingly. Operators who understand the mechanics can read the movement correctly; operators who don't end up chasing phantom drift that isn't really drift at all.

This lesson walks through the math under the percentage, the partial-credit mechanics, the license-gating that affects the max, and the five most-common reasons the score moves overnight.

## The basic math

The percentage is straightforward:

```
Secure Score % = (points earned across all applicable recommendations) ÷ (max possible points) × 100
```

Take a hypothetical example: a tenant whose Secure Score tile reads `88.79%` with `988.2 / 1113.0` underneath. The numerator (988.2) is the points the tenant has actually earned. The denominator (1113.0) is the max possible — the sum of point values for every recommendation that applies to this tenant given its licensing. The percentage is 988.2 ÷ 1113.0 × 100 = 88.79%.

Two things to notice about that denominator:

- **It's the *applicable* max, not the absolute max.** Recommendations the tenant isn't licensed for don't contribute to the denominator. A Business Premium tenant doesn't have its denominator inflated by E5-only recommendations like Sensitivity Labels or Insider Risk Management — those simply don't apply. This is fair and important: it means your customer isn't penalised for not having a license tier they don't pay for.
- **It changes when Microsoft changes their recommendation set.** If Microsoft adds a new recommendation worth 10 points, your denominator goes up by 10, your numerator stays the same (you haven't implemented the new recommendation yet), and your percentage drops slightly. This is the mechanism behind most "the score went down without us changing anything" mysteries.

## Partial credit — what it actually means

Many Secure Score recommendations award **partial credit** based on how completely the tenant has implemented the recommendation. The percentage you see on a recommendation in the portal — say "8.5 / 10 points earned" — typically reflects the partial implementation.

The most common partial-credit pattern is **per-user coverage**. The recommendation "Require MFA for all users" doesn't just toggle on or off; it scales with what fraction of your users actually have MFA enforced. If you have 40 users and 36 are enforced, you earn 36/40 of the recommendation's max points. The remaining four users (the executive who insisted on an exception, the service account, the two contractors you forgot about) cost you partial points.

Other partial-credit patterns:

- **Per-policy coverage.** "Ensure all anti-phishing policies use mailbox intelligence" awards full credit only if *every* anti-phishing policy in the tenant has the feature enabled — partial credit for the policies that do.
- **Threshold-based.** Some recommendations measure values that have to meet a threshold. "Ensure your sign-in risk policy is enabled" might award partial credit based on how much of the user base the policy covers.
- **Time-based.** A handful of recommendations check that audit logs are retained for at least N days — partial credit if you're retaining less than the recommended duration.

This matters for two operator workflows:

**Reading a recommendation correctly.** When you see a recommendation showing 80% of its max, that's not "we tried but kind of failed." It's likely "we've covered 80% of the targets and four specific users / policies / configurations are uncovered." Drilling into the recommendation in the portal typically reveals exactly which subset is missing.

**Moving the score efficiently.** When you're planning the next pass of security work for a customer, partial-credit recommendations are often the lowest-hanging fruit. A recommendation at 8.5/10 may only need you to enforce MFA on one more service account to claim the remaining 1.5 points. That's a five-minute change for measurable score movement. Spotting these is part of the work in lesson 3.

## License-gated recommendations and the "Risk Accepted" workflow

Microsoft Secure Score includes recommendations that require specific licenses to implement. Examples:

- **Defender for Identity deployment** (requires Defender for Identity standalone or E5 with the bundle).
- **Customer Lockbox** (E5).
- **Auto-labeling and data classification policies** (Information Protection P2 / E5 Compliance).
- **Sign-in risk policies** (Entra ID P2).
- **User risk policies** (Entra ID P2).
- **Insider Risk Management** (E5).
- **Attack Simulation Training** (E5).

Here's the part that catches operators by surprise: **these recommendations still appear in the tenant's recommendation list and still contribute to the max denominator even when the tenant doesn't have the required license**. Open a Business Premium tenant's Secure Score in the Defender portal and you'll see Defender for Identity, Customer Lockbox, Auto-labeling, and other E5-gated items sitting in the list with `0 / X points` next to them. They're dragging the percentage down despite being unimplementable on Business Premium.

Microsoft gives operators three alternate statuses for handling recommendations they can't or won't implement:

- **Resolved through third party.** Use this when a non-Microsoft tool handles the same security function. Microsoft awards full points for the recommendation as if you'd implemented it. Honest use cases: a third-party MDR covering the Defender-for-Identity function; a third-party DLP product covering Microsoft's labeling recommendation. Dishonest use cases — and operators do this — are marking things "third party" with nothing actually providing the function. The score goes up, the security doesn't.

- **Risk accepted.** Use this when you've reviewed the recommendation and decided not to implement (often because the license isn't there, or the customer's risk profile doesn't justify the operational cost). The recommendation stays in the max at zero points, but it's documented as a deliberate decision rather than an unaddressed item. Honest framing in customer conversations: "we reviewed this, here's why we accepted the risk."

- **Planned.** Use this when you've committed to implementing on a timeline but haven't yet. No points awarded, but the recommendation is flagged as queued work.

For most Business Premium tenants, **most license-gated recommendations get marked as Risk accepted** — the customer doesn't have the license, the MSP has documented the decision, and the recommendation no longer reads as "neglected." The Secure Score percentage doesn't go up from Risk accepting; the documentation goes up.

The Risk Accepted workflow is part of operator hygiene. Periodically (lesson 6 covers cadence) review the Risk Accepted list and confirm the reasoning still holds. If a customer later upgrades to E5, several Risk Accepted items become implementable and the operator should revisit the decisions. If a customer's risk profile changes, the same.

**Why this matters for cross-tenant comparison.** Two Business Premium tenants can have identical configurations but different Secure Scores depending on how many recommendations the operator has marked Risk accepted or Resolved through third party. A tenant where the operator has done the Risk-Accepted hygiene work will show a lower-but-more-honest percentage than a tenant where unlicensed-and-untouched items sit at zero with no decision recorded. Use the percentage as a starting point for the conversation about *what the operator did with each recommendation* — not as a direct comparison number.

## The category breakdown

Underneath the headline percentage, Microsoft breaks the score into categories — typically Identity, Devices, Apps, and Data. Each category has its own subtotal: points earned vs max possible within that category.

The category view is useful for diagnostic purposes. A customer with an 88% overall score might have:

- Identity at 95% (MFA, legacy auth, admin protection all in good shape)
- Devices at 92% (Intune templates well-deployed)
- Apps at 78% (email-side configurations partly missing)
- Data at 65% (DLP, sensitivity labels untouched — common for Business Premium tenants who don't have the licensing)

Reading the categories tells you *where* the score lives and *where* the gaps are. An operator doing pre-renewal review can use the category breakdown to focus the next quarter's work — "Identity is solid, Apps is where the next quarter's gain comes from" — rather than treating the headline percentage as the only signal.

## Why the score moves on its own — the six most-common reasons

Back to the opening anecdote. The Monday-morning drop from 88.79% to 86.94% without any tenant-side change. Six plausible explanations:

**1. A new vulnerability was detected in installed software.** For customers running Defender for Endpoint, Microsoft Defender Vulnerability Management (MDVM) feeds into Secure Score. When a new CVE is announced affecting software running on a managed endpoint — a Windows update, a Chrome version, an Acrobat Reader release, the SQL client on the file server — the score drops until the patch is deployed. This is the *most frequent* cause of overnight score drops on MDE-deployed tenants, because the world produces new CVEs constantly and patches lag detection by days. The good news: when the RMM runs its patch cycle and the vulnerable software updates, the points come back.

**2. Microsoft added a new recommendation.** Microsoft introduces new recommendations as the security landscape evolves — a new threat pattern, a new Defender feature, a new compliance requirement. The new recommendation contributes to the max (denominator goes up); the tenant hasn't implemented it yet (numerator unchanged); percentage drops. The Microsoft 365 Defender portal's Secure Score change history shows what was added.

**3. Microsoft retired or re-weighted an existing recommendation.** Less common but real. A recommendation Microsoft considers obsolete gets removed; the max shrinks; the percentage moves. A recommendation gets re-weighted (the points value changes); same effect.

**4. Tenant licensing changed.** If the customer added or removed licenses over the weekend (a new hire activated, a leaver deactivated, a license SKU swap), the applicable recommendation set shifted, and the max moved accordingly.

**5. Tenant configuration changed on Microsoft's side.** Some recommendations check configuration that Microsoft manages or that Microsoft updates defaults for. When Microsoft tightens or loosens a default, recommendations scoring against that default may move.

**6. Tenant configuration changed on the operator's side.** Either deliberate (drift you should investigate via the Tenant Change Log and Panoptica365's drift alerts) or accidental (somebody disabled something they shouldn't have). This is the case where the score is telling you something about *your* customer specifically.

When the score moves and you can't explain it from cases 4 and 6 (the tenant-side causes you control), the answer is almost always 1, 2, 3, or 5 — Microsoft side. The Secure Score change history in the Defender portal is where you confirm.

## Verifying with the Microsoft Defender portal

When the score moves unexpectedly, the diagnostic workflow is:

1. **Open the Microsoft 365 Defender portal** for the customer (`security.microsoft.com` → Secure Score).
2. **Look at the History tab.** Microsoft shows recent score changes with the underlying recommendation-level deltas.
3. **For any recommendation that changed status:** click into it. Read the description, the action history, the per-target detail (if it's a per-user/per-policy recommendation with partial credit).
4. **Cross-reference with Panoptica365's Tenant Change Log** to confirm whether the change came from the operator's side or Microsoft's.

This is per-tenant work. There's no fleet-wide "what changed across all 30 customers this week" view in Microsoft's portal; each customer is investigated individually when their score moves enough to warrant a look.

## What this means for the operator

Three takeaways.

**Score movement is usually Microsoft-side, not customer-side.** A Secure Score that drops without any tenant-side change is most often a new vulnerability surfacing on a managed endpoint (patch cycle catches up; points come back), or Microsoft adding / re-weighting a recommendation. Check the History tab in the Defender portal before assuming the customer's security has actually regressed.

**Partial credit is the operator's friend.** Recommendations at 80-95% of their max are usually one or two targeted changes away from full credit. Working those is the most efficient path to score movement. Recommendations at 0% are typically the bigger architectural items that require more work.

**License-gated recommendations stay in the max — managing them via Risk Accepted is part of operator hygiene.** A Business Premium customer's Secure Score includes E5-only recommendations (Defender for Identity, Customer Lockbox, Auto-labeling, etc.) sitting at zero points. The operator's job is deciding what to do with each: implement (if possible), Resolved through third party (if a tool covers the function), Risk accepted (with a documented reason), or Planned (if scheduled). Untouched license-gated items drag the score down without contributing security value — explicit Risk Accepted decisions make the percentage read more honestly and create the audit trail customers want at renewal.

## What's next

- **Lesson 3: Mapping the curriculum to the score.** Which recommendations from Microsoft's catalogue correspond to the work you've already done in Cards 3, 4, and 5 — and the high-leverage half-dozen that drive most of the score for an SMB customer.
- **Lesson 4: Where Secure Score misleads.** The blind spots, the gaming trap, and the work that doesn't show up in any number.

For now: pick the customer whose score puzzles you most. Open the Defender portal for that tenant. Read the History tab. Most of the time, what looked like drift is actually Microsoft changing the goal posts — and reading the score in that light changes how you act on it.

---

*Sources for the data points in this lesson — Microsoft Learn on how Microsoft Secure Score is calculated ([Microsoft Learn — How Secure Score is calculated](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions)); partial credit and recommendation scoring mechanics ([Microsoft Learn — Track your Microsoft Secure Score history](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-history-metrics-trends)); Secure Score data and categories ([Microsoft Learn — Microsoft Secure Score overview](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score)); license-gated recommendations and required permissions ([Microsoft Learn — Required licenses and permissions](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-required-permissions)); Secure Score API reference for programmatic access ([Microsoft Learn — Secure Score API in Graph](https://learn.microsoft.com/en-us/graph/api/resources/securescore)).*
