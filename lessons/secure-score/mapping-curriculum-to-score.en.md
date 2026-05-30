---
title: "Mapping the curriculum to the score — what moves the number and what doesn't"
subtitle: "Which Cards 3–5 controls translate into high-leverage Secure Score recommendations, and how to prioritise for maximum score gain."
icon: "git-compare"
last_updated: 2026-05-29
---

# Mapping the curriculum to the score — what moves the number and what doesn't

A customer's board member, freshly tuned-in to cybersecurity at a conference, asks the MSP for a written plan to "improve our Secure Score significantly over the next quarter." The customer is currently at 58%. The board member wants 80% by the next meeting. The MSP has roughly twelve weeks of operator time to put against this, spread across the customer's normal book of business.

What does the MSP do first?

This is the most common Secure Score operator question, and it has a precise answer: implement the **high-leverage half-dozen** — the six recommendations that move an SMB customer's Secure Score the most while also producing genuine security improvement. The half-dozen is where most of the gap between a 58% tenant and an 88% tenant lives. The rest is partial credit, license-gated items, and the long tail of smaller recommendations.

This lesson maps the work from Cards 3, 4, and 5 onto specific Secure Score recommendations, identifies the half-dozen, and previews what doesn't show up in the score at all (lesson 4 covers that in depth).

## The big picture — where the score lives

Most of an SMB tenant's Secure Score sits in three areas, each corresponding to one of the implementation cards in this curriculum:

- **Identity recommendations** (Card 3 — Conditional Access). MFA, legacy authentication blocks, admin protection, sign-in posture. For a Business Premium SMB tenant, identity recommendations typically contribute 30–40% of the achievable max.
- **Device recommendations** (Card 4 — Intune). Device compliance, BitLocker, ASR rules, Defender for Endpoint configuration. Roughly 25–35% of the achievable max.
- **Apps recommendations** (Card 5 — Email and collaboration). Anti-phishing, Safe Links / Safe Attachments, mailbox auditing, quarantine policy, auto-forwarding controls. Roughly 25–30% of the achievable max.
- **Data recommendations** (sensitivity labels, DLP, retention). Mostly E5-licensed; for Business Premium tenants these are typically Risk Accepted (lesson 2). Small contribution to the achievable max in practice.

The shape of an SMB customer's score: most of the points are in Identity, Device, and Apps. The customer who's at 41% has gaps across all three; the customer at 88% has covered the high-leverage items in each. The half-dozen below pulls one or two items from each of the three implementation cards.

## The high-leverage half-dozen

These six recommendations move the score most for SMB customers running Business Premium with the full Microsoft ecosystem. Implementing all six routinely accounts for most of the gap between a low-baseline tenant and an 80%-plus tenant.

**1. Require MFA for all users — Card 3 lesson 2.** Typically the single largest Secure Score gain available on any tenant. The recommendation rewards partial credit per user: full credit when 100% of users are enforced. Unenforced users (executives demanding exceptions, service accounts, contractors) cost partial credit. The Card 3 implementation pattern — deploy the "Require MFA for all users" CA template, scope to all users, manage exceptions via the per-user inclusion/exclusion discipline — directly drives this recommendation toward full credit.

**2. Block legacy authentication — Card 3 lesson 3.** The second-largest identity-side gain. Legacy auth bypasses MFA; blocking it closes the gap. The recommendation is scored binary — either legacy auth is blocked tenant-wide via Conditional Access, or it isn't. Implementation maps directly to the Card 3 lesson 3 "Block legacy authentication" CA template. No partial credit; one policy deployment moves the needle in one step.

**3. Enable BitLocker for OS drives — Card 4 lesson 4.** The largest device-side gain on most Windows fleets. Scored per device: full credit when every managed Windows device has BitLocker active on the OS volume. The Card 4 BitLocker Settings template configures this via Intune; the per-device credit accrues as devices encrypt. Customers with mixed-state fleets (some encrypted, some not) get partial credit; getting to full requires the operational work of bringing the unencrypted devices into line.

**4. Enable ASR rules in Block mode — Card 4 lesson 7.** Multiple ASR rules are individually scored — each rule that's enabled in Block mode contributes to the score. The Card 4 ASR Rules Standard template deploys all 19 ASR rules in Block mode out of the box; deploying this template (and confirming the rules apply to all managed devices) drives multiple per-rule recommendations to full credit simultaneously. This is the recommendation cluster where one deployment unlocks the most discrete score items.

**5. Enable mailbox auditing for all users — Card 5 lesson 6.** Scored binary: every mailbox in the tenant either has audit logging enabled, or it doesn't. The Card 5 lesson 6 mailbox auditing setting pushes this tenant-wide via Panoptica365. New mailboxes drift to default audit settings (the canonical example from Card 5); reapplying the strict posture restores full credit. The recommendation is also one of the highest-impact items for forensic readiness — score and security align cleanly here.

**6. Enable preset security policy Standard or Strict — Card 5 lessons 3, 7, and 10.** This is the bundle multiplier. Microsoft's preset security policy configures anti-phishing, Safe Links, Safe Attachments, anti-malware, and quarantine policies all in one. Enabling Standard or Strict at the tenant moves multiple discrete Secure Score recommendations to full credit simultaneously — typically a 5–10 point swing on a Business Premium tenant. Implementation is three clicks in the Defender portal; this is the single highest leverage-per-effort recommendation in the entire curriculum.

These six items, implemented end-to-end on a customer starting at 41%, will routinely move that customer to the 75–85% range. The remaining gap to 88%+ comes from the long tail of smaller recommendations (partial-credit items, additional ASR rules outside the standard set, smaller anti-phishing tunings, license-gated items handled via Risk Accepted, vulnerability remediation that has to happen continuously, etc.).

## DKIM enable — the half-dozen's near-miss

Worth calling out separately because it's the email-authentication item Card 5 covered but didn't make the half-dozen:

**Enable DKIM signing for all custom domains — Card 5 lesson 4.** This *is* a Secure Score recommendation, separately scored, and reasonably high-value. It's not in the half-dozen because the per-domain implementation work — publishing DNS CNAMEs for each accepted domain, enabling signing per-domain in the M365 portal — is a more involved operational task than the half-dozen items, and the score contribution per tenant is smaller than each of the six above. But it should be on the operator's near-term list for any customer running the full email stack.

Worth being explicit about what's scored and what isn't on the email-authentication side: **DKIM enablement is scored** (Microsoft can verify the tenant-side toggle and the published DNS records). **SPF publication is not scored as a Secure Score recommendation in the way operators sometimes assume** — even though SPF is critical for the broader email-authentication picture. **DMARC publication and the full `p=none → p=quarantine → p=reject` journey is not scored at all** — Microsoft can't reliably verify what's at `_dmarc.customer.com` for arbitrary external domains. The DMARC work matters for security; it just doesn't move the score. Lesson 4 of this card covers this and other unscored-but-critical work in depth.

## The long tail — partial-credit and license-gated items

Beyond the half-dozen, dozens of smaller recommendations contribute to the score. Some examples:

- **MFA for administrative roles** — distinct from "MFA for all users"; often already covered if the all-users policy is in place, but called out as its own recommendation.
- **Disable individual sign-in methods** (SMS-based MFA, voice-call MFA) — small per-method recommendations.
- **Specific ASR rules not in the standard set** — additional rules that aren't part of the Card 4 ASR template's 19 but are scored individually.
- **Vulnerability remediation** — MDVM-driven per-CVE recommendations that come and go as Microsoft detects new vulnerabilities on managed endpoints (the daily score-moving cause from lesson 2).
- **Configure anti-spam outbound policy to restrict** — Card 5 lesson 9; smaller individual contribution.
- **Disable Basic Auth for SMTP submission** — Card 5 lesson 9; small but tracked.
- **Block external auto-forwarding** — Card 5 lesson 5; small but tracked.

These items don't individually move the score by much, but in aggregate they account for the gap between an 80% tenant and an 88% tenant. The work of bringing a customer from "good enough" to "exemplary" is the work of grinding through this long tail — most of which the curriculum has already covered in Cards 3, 4, and 5.

## What's NOT in the score — the preview

To preempt the operator's natural question: a lot of the work in Cards 3, 4, and 5 doesn't show up in the Secure Score at all. Lesson 4 covers this in detail, but the headline list:

- **DMARC publication and the full enforcement journey** — DNS-side; unscored.
- **SPF publication** — unscored as a verified DNS-side check.
- **Customer-specific anti-phishing trusted-senders lists** — the *preset* is scored; the per-customer tuning isn't.
- **Mail flow rule hygiene** — the work of auditing transport rules quarterly; not scored.
- **Per-domain Remote Domain auto-forward exceptions** — the tenant-wide block is scored; the exception ledger discipline isn't.
- **Drift detection and triage** — the operational rhythm at the heart of Cards 4 and 5; not scored.
- **Annual configuration debt reviews** — the audit work; not scored.
- **Customer exception ledger maintenance** — the discipline that compounds; not scored.
- **Security awareness training and phishing simulations** — even when run; not directly scored (related E5-only "Attack Simulation Training" is scored if you have it, but the awareness work itself isn't).
- **Incident response capability** — the off-platform discipline of having a runbook, having tested it, having an after-hours contact — none of this is scored.

This isn't a complaint about the score; it's a fact about what the score measures. A tenant at 92% with no operational discipline is less secure than a tenant at 82% with an MSP who responds to drift alerts within hours and runs annual reviews. Lesson 4 makes this explicit.

## What this means for the operator

Three takeaways.

**The half-dozen is where the customer-improvement plan lives.** When a customer asks "how do we improve our score?" — and they will — the answer is the six items above, in order of leverage. Most of the gap between a low-baseline tenant and a healthy SMB tenant lives in these six recommendations. Document the half-dozen as a worked plan; bring it to renewal meetings as the visible improvement path.

**The curriculum is the score driver.** Most of the work in Cards 3, 4, and 5 directly raises the Secure Score. Operators who've internalised the curriculum have already done — or know exactly how to do — the work that moves the percentage. The Secure Score isn't a separate project; it's the measurement layer over the work the curriculum teaches.

**Operational discipline doesn't score. Do it anyway.** A meaningful fraction of the security value delivered by a good MSP doesn't show up in Secure Score at all — drift triage, annual reviews, customer exception management, DMARC enforcement, mail flow rule hygiene. Customers measure you by the score because it's the number they can see; you have to know that the unscored work is what keeps them secure between snapshots.

## What's next

- **Lesson 4: Where Secure Score misleads.** The blind spots, the gaming traps, and the 92%-and-got-BEC'd story. Why chasing 100% is the wrong goal — and what the right goal looks like.
- **Lesson 5: Customer-facing Secure Score.** How to use the percentage in renewal conversations, baseline reporting, and trend storytelling.

For now: open Panoptica365's main dashboard, find the customer with the lowest Secure Score in your book. That's the customer whose half-dozen plan you should write this week. Six recommendations, each mapped to a Card 3 / 4 / 5 lesson, each with a defined implementation. By the next renewal conversation, that customer's score has moved.

---

*Sources for the data points in this lesson — Microsoft Learn on Microsoft Secure Score recommendation catalogue ([Microsoft Learn — Improvement actions](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions)); Conditional Access recommendation scoring for MFA and legacy auth ([Microsoft Learn — Conditional Access Secure Score recommendations](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policy-common)); BitLocker and Intune compliance recommendations ([Microsoft Learn — Intune Secure Score recommendations](https://learn.microsoft.com/en-us/mem/intune/protect/security-baseline-settings-mdm-all)); Attack surface reduction rules Secure Score reference ([Microsoft Learn — Enable ASR rules](https://learn.microsoft.com/en-us/defender-endpoint/enable-attack-surface-reduction)); mailbox auditing recommendation ([Microsoft Learn — Enable mailbox auditing](https://learn.microsoft.com/en-us/purview/audit-mailboxes)); preset security policy Secure Score impact ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)); DKIM signing recommendation ([Microsoft Learn — Use DKIM to validate outbound email](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure)).*
