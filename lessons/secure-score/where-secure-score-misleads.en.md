---
title: "Where Secure Score misleads — the 92%-and-got-BEC'd story and the gaming trap"
subtitle: "A 92% score didn't prevent a $94k BEC. The blind spots, the gaming trap, and the security work that never shows up in any number."
icon: "triangle-alert"
last_updated: 2026-05-29
---

# Where Secure Score misleads — the 92%-and-got-BEC'd story and the gaming trap

A 60-person logistics company is at a 92% Microsoft Secure Score. The MSP managing the tenant is proud of the number. The customer's executive team has seen the score in their quarterly review and is satisfied. The previous year's number was 79%; the work to move it up showed up in the renewal proposal and the renewal closed cleanly. By any conventional measure of how an MSP demonstrates value, this tenant is in the top quartile.

On a Tuesday morning in November, the controller forwards a $94,000 wire to what she believes is the customer's new logistics partner. The wire instructions came in an email that looked exactly like the partner's normal communication style. The email passed SPF and DKIM authentication — it really did come from the partner's domain. The partner's email had been compromised by an AiTM-equipped attacker two days earlier. The attacker had read the in-progress logistics deal conversation and inserted themselves with a wire-redirect message at the perfect moment.

The Secure Score doesn't move. The MSP's tenant configuration is still at 92%. Microsoft's recommendations are still implemented. None of them prevented this attack.

The customer's lawyer wants to understand. The insurance underwriter wants to understand. The MSP's senior consultant has to explain the gap between "92% Secure Score" and "got BEC'd for $94,000." This lesson is about that gap.

## What the score measures vs what it doesn't

The score measures **whether the customer's tenant has configurations that Microsoft recommends.** Each configuration has been chosen by Microsoft because it's a useful baseline defence. Implementing them all moves the tenant from "default factory settings" to "Microsoft-recommended baseline." That's genuine security value.

The score does *not* measure:

- Whether the configurations are well-tuned for the customer's actual risk profile
- Whether the customer has been attacked
- Whether the operator responds quickly when something drifts
- Whether the customer's vendors and partners have basic email security
- Whether the customer's users have been trained to recognise sophisticated phishing
- Whether the off-platform incident response capability exists
- Whether the customer's DMARC enforcement is in place
- Whether the customer's exception ledger has been reviewed recently
- Whether MailTips actually reach users (some users disable them at the mailbox level)
- Whether the operator audits transport rules quarterly
- Whether the operator catches anomalous sign-in patterns inside the response window

The logistics company at 92% had a perfectly-configured tenant by Microsoft's recommendation set. The attack came in through a vector the recommendation set doesn't address — a compromised partner's email, used to insert a redirect message into an in-progress conversation. The score had nothing to say about the partner's email hygiene, the customer's wire-verification process, or the operator's response time when the attack landed. The score wasn't *wrong*; it just wasn't *complete*.

## The gaming trap — when the score lies because the operator helped it

There are honest ways for a Secure Score to climb (implement the recommendations) and dishonest ways. Operators sometimes — under pressure, under time, or because the customer is watching the number — drift into the dishonest ways. This is the gaming trap, and recognising it in your own work is part of professional discipline.

The three most common gaming patterns:

**1. "Resolved through third party" with no third party.** Lesson 2 introduced the option: when a non-Microsoft tool genuinely covers the same security function, you can mark a recommendation as resolved and get the points. Some operators apply this to recommendations they simply don't want to implement, claiming "third party" coverage that doesn't exist or doesn't actually cover the function. The score goes up. The security doesn't. The audit risk is the same.

**2. Marking implementation "complete" when it's not.** Some Secure Score recommendations check tenant configuration that Microsoft can verify automatically (binary: is the setting on or off?). Others require operator self-attestation — "yes, we've completed this." When an operator marks something complete without actually completing it, the score reflects the attestation, not the reality. This is genuinely fraud in some compliance contexts.

**3. Risk-Accepting recommendations to clear the visual noise.** Recommendations sitting at zero points drag the percentage down. Risk-Accepting them doesn't move the points but does change the visual presentation in the portal. An operator who Risk-Accepts everything they can't or won't implement is being honest. An operator who Risk-Accepts items that *should* be implemented — because doing so makes the dashboard look cleaner — is gaming. The line between hygiene (Risk-Accept what's genuinely not applicable) and gaming (Risk-Accept what's inconvenient) is the operator's professional judgment.

The honest test for any of these: would you be comfortable showing the recommendation and the action taken to the customer in a renewal meeting? "We marked Customer Lockbox as Risk Accepted because the tenant doesn't have E5 licensing and we documented the alternatives we use instead" — that's defensible. "We marked Defender for Identity as Resolved through third party because... uh... well, the score number looks better" — that's not.

## Recommendations that are scored but operationally painful

A separate trap: some Secure Score recommendations are configured to award points for settings that, when implemented blindly, hurt customer operations. Implementing them correctly requires the customer-specific tuning the score doesn't measure.

Examples:

**"Enable Controlled Folder Access in Block mode."** Card 4 lesson 7 covered this directly. Microsoft awards more Secure Score points for CFA set to Block than to Audit — Block actually prevents protected-folder writes by non-allowlisted apps, while Audit only logs them. But Block mode without a customer-specific app allowlist generates a flood of help-desk tickets on day one: backup tools writing to user documents, sync clients (Dropbox, Google Drive, OneDrive variants), creative apps writing to Documents, productivity tools auto-saving. The Panoptica365 ASR template ships CFA in Audit mode specifically because Block-out-of-the-gate is operationally untenable. Flipping CFA to Block purely for Secure Score points, without the audit-log review and allowlist build, breaks legitimate workflows. The right operator pattern is lesson 7's: ship in Audit, watch for two to four weeks, build the allowlist from the audit-mode write attempts, then flip to Block. Score moves at the end, not the beginning.

**"Block legacy authentication."** Card 3 lesson 3 already covered this — and it's the right call. But if you implement it without first identifying the legacy printers, the legacy LOB apps, and the legacy MFA-incompatible workflow the customer has, you break things. The score moves; the help desk floods. The right operator pattern is the pre-flight audit followed by the deployment, not the deployment alone.

**"Designate more than one global admin."** Microsoft rewards having multiple global admins (resilience against any one losing access). Some customers have only one — often deliberately, often for good reasons (smaller threat surface, simpler audit). Implementing the recommendation by adding more global admins without thought adds attack surface for the score. The Card 3 lesson 6 admin-hardening discipline is the right answer here.

These recommendations aren't bad recommendations. They're recommendations that require operator judgment about *how* to implement, not just *whether* to implement. The score doesn't reward judgment; it rewards configuration state.

## The recommendations the score doesn't track at all

This is the heart of the lesson. A meaningful fraction of the security work a competent MSP does is invisible to Microsoft Secure Score. Not because Microsoft doesn't think it matters — but because the score can only measure what Microsoft can programmatically verify in the tenant.

**DMARC and SPF publication and enforcement.** The full SPF / DKIM / DMARC journey from `p=none` to `p=reject` matters enormously for inbound email-spoofing protection. **DKIM enablement** (the tenant-side toggle in the M365 admin centre) is scored — Microsoft can verify it. **SPF and DMARC publication are not** — they're external DNS records Microsoft can't reliably verify at the scale of every M365 tenant in the world, so the score doesn't include them. Customers who've done the full email-authentication work look the same in Secure Score as customers who've only enabled DKIM. The work matters; the score doesn't measure it.

**Operational discipline.** Drift triage time. Alert response time. Exception ledger maintenance. Annual review completion. The discipline of *actually doing the work between snapshots* — that's the whole operational thesis of Cards 4 and 5, and none of it shows up in the score. A tenant whose MSP responds to drift alerts within an hour has the same score as a tenant whose MSP responds within a week, given identical current configuration.

**Customer-specific tuning.** Anti-phishing protected-users lists. Trusted-senders lists scoped to specific business partners. Per-customer Remote Domain auto-forward exceptions. Mail flow rule audit. All Card 5 content. The preset security policy enablement is scored; the customer-specific tuning underneath isn't.

**Incident response capability.** Does the MSP have a written BEC response runbook? Has it been tested? Is there an after-hours contact path for the customer? Can the operator team execute a credential reset / session revocation / inbox-rule audit within 30 minutes when an alert fires? None of this is scored. None of it is part of Microsoft's recommendation set.

**Vendor and partner email hygiene.** The 92%-from-the-opener attack came through a compromised vendor. Whether the customer's vendors have proper email authentication, whether they've been compromised recently, whether the customer's wire-verification process treats vendor-sourced messages with appropriate scepticism — all unscored.

**User security awareness.** Phishing simulation completion rates. Trained-vs-untrained ratios. Reporter-rate per user. None of this is directly in Microsoft Secure Score (Attack Simulation Training is E5-only, and even that scores the configuration of the simulation tool, not the customer's user-training outcomes).

The list could continue. The pattern: **anything that requires human judgment, ongoing operational work, or visibility into things Microsoft can't programmatically verify about the customer's environment is unscored.** The Secure Score measures the configuration snapshot. The unscored work is what keeps the customer safe in the moments between snapshots.

## Why chasing 100% is the wrong goal

A 100% Secure Score is achievable in principle but rarely correct in practice. Reasons:

- **Some recommendations don't fit some customers.** A small accounting firm doesn't need Insider Risk Management. Forcing the recommendation to "complete" status with a fake third-party attribution is gaming.
- **License-gated recommendations require license upgrades.** A Business Premium customer can't honestly implement E5-only features. Risk-Accepting them and accepting a lower percentage is more honest than gaming the workaround.
- **Some recommendations conflict with customer operational realities.** Outbound spam policy set to its strictest restrict-and-block action without tuning for the customer's legitimate high-volume senders (sales people on a campaign day, communications people sending the annual employee letter). Multiple global admins on a single-owner business. Legacy auth block on a tenant with critical legacy LOB apps that haven't been modernised yet.
- **The marginal points above ~88% require diminishing returns.** Each remaining recommendation contributes less; the operational cost to implement is often disproportionate to the security gain.

The right Secure Score goal, for Business Premium customers running the full ecosystem, is **80% or above with honest Risk Accepted decisions documented for everything below**. High 80s is achievable for customers where the operator has done the full implementation work. 90%+ requires customer-specific factors aligning (no E5-only recommendations applicable, no operational constraints) and rarely comes from incremental score-chasing.

Lesson 6 covers the target framing in operational detail. For this lesson, the principle: a 100% target distorts the work. An 80%-with-discipline target focuses it.

## What this means for the operator

Three takeaways.

**Secure Score measures configuration, not security.** The 92%-and-got-BEC'd story is the cautionary case every operator needs in their head. A high score is a configuration achievement; it's not a security guarantee. Use it as one of several signals, not as the headline conclusion.

**Recognise the gaming patterns in your own work.** "Resolved through third party" with no third party. Self-attestation without follow-through. Risk-Accepting to clear visual noise rather than to document genuine non-applicability. These are easy to slide into under pressure. The honest test: would you defend the action to the customer in a renewal meeting? If not, don't take it.

**The unscored work is what keeps the customer safe.** DMARC publication, drift triage, exception ledger maintenance, customer-specific tuning, incident response capability, vendor email-hygiene awareness — none of this scores, all of it matters. The operator's professional value is largely in the unscored work. Communicate that to customers explicitly; don't let them mistake the score for the whole story.

## What's next

- **Lesson 5: Customer-facing Secure Score.** How to use the percentage in customer conversations honestly — the renewal narrative, the trend over time, the baseline-at-onboarding story.
- **Lesson 6: Operating Secure Score at scale + closing the curriculum.** The quarterly review cadence, the 80%+ target framing, and the closing argument for the curriculum.

For now: pick the customer with the highest Secure Score in your book. Look at their recommendation list. For each recommendation marked "Resolved through third party," can you name the third-party tool and confirm it actually covers the function? For each "Risk Accepted," can you defend the acceptance reason? The gaming patterns are usually quiet — finding them in your own work is the discipline. Find them before a customer or auditor does.

---

*Sources for the data points in this lesson — Microsoft Learn on Secure Score limitations and what the metric measures ([Microsoft Learn — Microsoft Secure Score overview](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score)); recommendation status options including third-party and Risk Accepted ([Microsoft Learn — Track recommendation completion](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions)); BEC and AiTM attack pattern context ([CISA — Business Email Compromise](https://www.cisa.gov/topics/cyber-threats-and-advisories/business-email-compromise-bec)); Controlled Folder Access modes (Audit vs Block) and operational considerations ([Microsoft Learn — Controlled Folder Access](https://learn.microsoft.com/en-us/defender-endpoint/controlled-folders)); global admin best-practice guidance ([Microsoft Learn — Protect admin accounts](https://learn.microsoft.com/en-us/microsoft-365/admin/security-and-compliance/protect-global-admin)).*
