---
title: "Business email compromise — what attackers actually do once they're in"
subtitle: "BEC converts mailbox access into wire-transfer fraud — $2.77B lost in 2024 alone; every other attack in this card exists to enable it."
icon: "mail-warning"
last_updated: 2026-05-29
---

# Business email compromise — what attackers actually do once they're in

A construction firm's accounts-payable clerk gets an email from the firm's regular supplier in Quebec: "Hi Susan, please note our banking details have changed. New ACH information attached. Please update on your end for the next invoice." The email comes from the supplier's real email address. The grammar is good. There's a follow-up email two days later asking about the status of the next invoice. Susan updates the banking info and processes the $187,000 payment.

The supplier never sent that email. Their mailbox had been compromised six weeks earlier through an AiTM phishing campaign. The attacker had been reading the supplier's email for over a month, waiting for the construction firm's next invoice cycle to come up. The attacker sent the banking-change message from inside the supplier's own outbox, deleted it from sent items immediately, and routed all reply email from the construction firm to a hidden inbox folder so the supplier never saw the conversation happening on their behalf.

That is business email compromise, and according to the FBI's Internet Crime Complaint Center, it cost American businesses **$2.77 billion in 2024 alone**, across 21,442 reported incidents. Total BEC losses 2022–2024: nearly **$8.5 billion**. The actual number is higher — most BEC incidents go unreported because victims are embarrassed and insurers don't pay out without proof.

Every other attack in this card — credential stuffing, MFA fatigue, AiTM, OAuth consent, device-code abuse — exists primarily *to enable BEC*. BEC is the payday. Without BEC at the end, none of the rest is worth the attacker's time.

This lesson is what BEC actually looks like inside a compromised mailbox, how attackers stay quiet for weeks, what specific signals to watch for, and why "weird mailbox rule" matters more than "weird login" once compromise has happened.

## The economic shape of BEC

BEC works because it converts identity compromise into wire transfers. The attack chain looks like:

1. **Initial compromise** of one user's M365 identity, via any of the methods in lessons 1–5.
2. **Reconnaissance** inside the mailbox: who does this user pay, who pays them, what's the invoice cycle, who has authority over wire transfers, what banking details are stored where.
3. **Quiet manipulation**: create hidden inbox rules, set up forwarding, sometimes register a homoglyph domain that looks like a vendor's real domain (`d̲i̲enamex.com` vs `dienamex.com` — different `i`).
4. **Strike**: typically the moment a real invoice is in flight, the attacker injects a fraudulent banking-details change. The legitimate parties never see each other's mail because the rules suppress it.
5. **Cash out**: the money moves to an attacker-controlled bank account, often in a chain through money mules.
6. **Cleanup**: rules are removed, mail is deleted, the attacker often retains access for follow-up campaigns.

The entire cycle from compromise to cash-out can be days, weeks, or months. The longest dwell times — six months or more — are usually executive-assistant compromises where the attacker patiently monitors C-suite communications waiting for the right moment.

## What an attacker does in the first hour after compromise

Knowing the attacker's playbook helps the operator triage faster when a compromise is fresh. Here's the typical first-hour activity, in order:

**Hour 0, minute 0–5: Verify the access works.** Sign in to the mailbox via the web. Open Outlook. Read a few recent emails. Confirm this isn't a honeypot or a trap.

**Minutes 5–15: Recon the mailbox.** Search the inbox for terms like `wire`, `invoice`, `payment`, `ACH`, `routing`, `bank`. Browse contacts. Look at the user's calendar to understand who they meet with. Read recent threads with vendors and customers.

**Minutes 15–30: Set up persistence.** Three patterns, often in combination:
- *Inbox rule*: forward all mail matching "invoice OR payment OR wire" to a hidden folder (e.g., a folder named "RSS Feeds" that nobody opens). Move from the inbox immediately.
- *Forward to external address*: copy of every email auto-forwarded to a Gmail or Proton address controlled by the attacker.
- *Mailbox-level forwarding* (using `Set-Mailbox -ForwardingSmtpAddress`): forwards even when no inbox rule exists. Harder for the user to notice because it's not in the rules UI.

**Minutes 30–45: Register their own MFA method.** So they don't need to repeat the initial compromise. Often a phone number under their control, sometimes a software authenticator they own. This is one of the most reliable signals that an attacker is in.

**Minutes 45–60: Quiet down.** Stop active activity. Wait for natural mailbox traffic. The setup is in place; the strike will happen later.

By the end of hour 1, the attacker has *persistence, reconnaissance, and channel control*. The user has noticed nothing.

## What an attacker does over the next two to six weeks

If the attacker is patient (and the high-value ones always are), they wait for the right opportunity. During this window they:

- Read mail as it arrives via the forwarding rules.
- Track invoice cycles — when does this customer pay, what's the typical amount, who approves it, what's the wording of normal banking-details changes.
- Identify the most valuable target. Sometimes the compromised user *isn't* the target — they're an entry point into a larger relationship. A junior employee's mailbox might be valuable because it reveals the CFO's schedule.
- Test the limits. Send small experimental emails (sometimes drafts saved and then deleted) to gauge whether anyone notices unusual outbox activity.
- Set up homoglyph domains for the eventual strike. Sometimes purchase certificates so the domain looks credible.

When the strike comes, it's often *one email*. The pretext is well-crafted, the timing is exact, the wording matches the legitimate user's normal style (which the attacker has been studying for weeks). The legitimate user often never sees the strike email because their own rules route it away.

## What gets caught and what doesn't

**What Microsoft's stack catches well:**

- Mailbox-level auto-forwarding to external addresses (Exchange Online Protection blocks it by default in many configurations as of 2024).
- Anonymously-shared SharePoint links from compromised accounts to external domains.
- Sudden registration of new MFA methods (Entra audit log signal, catchable).
- Defender XDR Attack Disruption for high-confidence BEC incidents (when correlated with sign-in anomalies).

**What's harder to catch:**

- *Hidden inbox rules* that route mail to obscure folders inside the mailbox without forwarding externally. From Exchange's perspective, this is the user organising their own mailbox. The rule exists in mailbox state but doesn't trigger forwarding-rule alerts.
- *Homoglyph domain emails sent to the user's contacts from an external attacker mailbox*. These don't originate from the compromised user's account, so the user's mailbox auditing doesn't see them. The supplier's customer sees an email from "the supplier" and acts on it.
- *The actual fraudulent wire instructions*. By the time the email is sent, it's just an email. The fraud is committed in the bank account, not in the mailbox.

This is why detection has to be layered across multiple signals — sign-in pattern + inbox rule activity + outbound mail pattern + post-payment anomaly detection.

## Specific signals worth watching for

A non-exhaustive list of the patterns that, in combination, almost always indicate BEC:

**Inbox rule created with a "forward to" or "move to folder" action where the folder is obscure** (RSS Feeds, Archive sub-folders, Notes). Especially if the rule's conditions include financial keywords. The rule pattern is the most reliable single BEC signature.

**Mailbox-level forwarding configured** via `Set-Mailbox -ForwardingSmtpAddress`. This requires PowerShell or admin-portal access — most legitimate users don't set this themselves. Panoptica365 monitors for this specifically.

**A new MFA method registered shortly after a foreign-IP or impossible-travel sign-in.** Strong attacker-persistence signal.

**A burst of outbound emails from the compromised account to financial contacts** (customers, vendors, banks) at unusual hours or with unusual wording. Defender for Cloud Apps's user-behaviour analytics catches some of this; the rest requires direct observation.

**Suspicious mailbox-permission grants** — particularly `FullAccess` or `SendAs` granted to an unfamiliar account. Attackers sometimes grant themselves access to *other* users' mailboxes via the compromised user's admin privileges, if the compromised user is an admin.

**Searches in the mailbox for financial terms** appearing in the search query log. Defender for Cloud Apps can surface this; the Unified Audit Log captures `MailItemsAccessed` and `Search` events.

**Banking-details-change emails sent to or from the user that don't match the wording or formatting of historic legitimate change requests.** This one is hardest to automate; often catches manual review by an alert finance person.

## What Panoptica365 sees

This is the deepest detection category in Panoptica365's catalogue. Many of the EXO-focused evaluators in Panoptica365 exist specifically because of BEC:

- **Inbox rule changes**, including creation of rules with suspicious actions (move to obscure folder, forward externally, delete on receipt).
- **Mailbox-level forwarding configured** — Panoptica365 watches the `ForwardingSmtpAddress` property on every mailbox and alerts when an external forwarding target appears.
- **Mailbox permission grants** — when someone gets FullAccess or SendAs on a mailbox they shouldn't have.
- **Anti-phish preset state** — making sure Defender for Office 365's anti-phish protections are still on (attackers sometimes lower them if they've gained admin access).
- **New MFA method registered** — the post-compromise persistence signal.
- **Foreign-IP successful sign-in** — the upstream sign-in that often precedes BEC.
- **Defender XDR BEC incidents** ingested from Microsoft's correlation layer.

When several of these fire on the same user within the same week, treat it as a confirmed compromise and run the response playbook below.

## Response playbook for confirmed BEC

When you've established that BEC is happening (or has happened), the cleanup is involved. The high-level steps:

**1. Isolate the user.** Revoke all sessions, force password reset, disable any new MFA methods that were added during the compromise window. If the user has admin privileges and you think those were used, audit and reset admin assignments.

**2. Find and remove the rules.** Inbox rules (`Get-InboxRule`), mailbox-level forwarding (`Get-Mailbox -ForwardingSmtpAddress`, `Set-Mailbox -ForwardingSmtpAddress $null`). Get rule history from the Unified Audit Log if needed — sometimes attackers create and then delete rules to cover their tracks.

**3. Identify who got fraudulent emails sent to them.** Pull the mailbox's sent items from the past 4–8 weeks. Audit log will show emails that were sent and then deleted. Look for emails to financial contacts that look like banking-change requests or invoice-payment confirmations.

**4. Notify recipients of fraudulent emails.** This is the part nobody likes. Anyone who received an email from the compromised user during the dwell period needs to know — both because they may have acted on it (need to stop a payment, reverse a wire) and because their own account may be next.

**5. Coordinate with the customer's bank if a wire has already moved.** Most banks can claw back wire transfers if reported quickly (typically within 72 hours). The FBI's IC3 also has a wire-recovery process for cross-border transfers. Speed matters.

**6. Audit other users in the same tenant.** Attackers often pivot from the initial victim to other users (especially admins). Check sign-in patterns and inbox rules for everyone in the tenant.

**7. Document for cyber insurance.** Most BEC claims require evidence of the compromise vector, the timeline, the controls that were in place, and the response actions. Panoptica365's audit log and the tenant change log are useful here. Keep clean records.

**8. Brief the customer on what changed and what to fix structurally.** This is the part that converts an incident into improved security posture. Often the underlying issue is "no MFA on the compromised user" or "Business Standard licence so no Conditional Access" — those are real conversations that the BEC incident is now your evidence for.

## Defending against BEC structurally

The defences for BEC are the cumulative defences from lessons 1–5, plus a few BEC-specific:

**Block external auto-forwarding** at the Exchange transport rule level. Most tenants don't need users to auto-forward externally; tenants that do can whitelist specific business cases. The default-off posture eliminates one of the attacker's favourite persistence techniques.

**Alert on inbox rule creation** that includes forwarding or hidden-folder actions. Panoptica365 surfaces this.

**Require admin approval for new mailbox-level forwarding** configurations. Customers with sensitive finance roles should consider preventing it outright.

**Train the finance team specifically.** Banking-details changes should always be verified out-of-band — a phone call to a number on file, not a number from the email. This is one of the few security trainings that has saved measurable money in real incidents.

**Apply Conditional Access to require phishing-resistant MFA for high-risk finance users.** The same control that defeats AiTM also defeats most of the upstream initial-access methods that lead to BEC.

**Deploy Defender for Office 365 anti-phishing policies with impersonation protection.** Helps catch the homoglyph-domain emails before they're delivered.

**Monitor mailbox audit log retention.** Default is 90 days; for sensitive customers, extend to a year. When BEC is discovered six months after the fact, you'll need the older audit log to reconstruct what happened.

## What this means for the operator

Four takeaways.

**BEC is what makes all the earlier attacks profitable.** Every defensive control in lessons 1–5 is, in effect, a BEC mitigation. When you're recommending phishing-resistant MFA or compliant-device CA to a customer, the elevator pitch is: "this is what stops the silent invoice-fraud attack that has cost American businesses $8.5 billion in the last three years."

**Inbox rules are the BEC tell.** When a foreign-IP sign-in alert lands, the immediate next check is the user's inbox rules. New rule with "forward to" or "move to RSS Feeds" actions on financial keywords? That's an active BEC operation. Open the ticket as severity-high and start the playbook.

**The "ninety-day dwell time" is real.** When you discover BEC, look back at least three months in the audit log. The attacker has often been quiet for weeks. Anything you see in the past 30 days is the tip; the full extent usually goes further back.

**BEC is a finance training problem as much as a security technology problem.** The technical controls cut the attack surface; the cultural control ("never accept a banking change via email; always verify out-of-band") cuts the impact. Make sure your customer engagements include the finance-team conversation, not just the IT-team conversation.

## What's next

- **Lesson 7: When the MSP is the target.** The reverse-direction attack. Your customers depend on you; so does any attacker who wants their data. The supply-chain compromise of an MSP is a 2026 reality the entire card has been leading up to: every attack in this lesson, multiplied by 30 or 100 if the attacker gets to the MSP first.

For now: BEC is the cash-out, the reason everything else exists, and the single largest cybercrime loss category on the FBI's books for the last three consecutive years. The compromise itself is *the* business problem you're protecting customers from. Treat every alert in this card with the BEC endgame in mind.

---

*Sources for the data points in this lesson — FBI IC3 BEC loss data 2024 ([FBI IC3 2024 Annual Report](https://www.ic3.gov/AnnualReport/Reports/2024_IC3Report.pdf)); BEC three-year aggregate loss figure ([Nacha — IC3 finds $8.5B BEC losses](https://www.nacha.org/news/fbis-ic3-finds-almost-85-billion-lost-business-email-compromise-last-three-years)); Microsoft on external mailbox-forwarding blocking ([Microsoft Learn — Block external email auto-forwarding](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-external-email-forwarding)); BEC-related Defender XDR Attack Disruption ([Microsoft Learn — Automatic attack disruption](https://learn.microsoft.com/en-us/defender-xdr/automatic-attack-disruption)); Defender for Office 365 anti-impersonation policies ([Microsoft Learn — Anti-phishing policies](https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-policies-about)).*
