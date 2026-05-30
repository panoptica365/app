---
title: "Auto-forwarding and inbox rules — the post-compromise indicator pair"
subtitle: "How attackers use auto-forwarding and hidden inbox rules to persist after compromise — and the outbound-transport controls that stop them."
icon: "forward"
last_updated: 2026-05-29
---

# Auto-forwarding and inbox rules — the post-compromise indicator pair

A customer's accountant phones in a panic on a Tuesday morning. "My contact at our supplier just called. He said he replied to my email about the wire transfer last week and never heard back, then sent two follow-ups, and finally called. I never got any of his emails. I never sent him any wire transfer email. He's looking at three messages in his sent folder from me."

You log into the accountant's mailbox. In Outlook on the web, you check rules. There's one you didn't create:

- **Rule name:** `.` (a single period)
- **Condition:** subject contains "wire" or "payment" or "supplier" or "transfer"
- **Action:** move to the `RSS Subscriptions` folder; mark as read; delete

You check Forwarding settings. Not configured. You check the Unified Audit Log. The rule was created at 3:42 AM the previous Wednesday from an IP in a country the accountant has never visited, using a session that authenticated successfully — meaning either the attacker had a stolen session cookie (AiTM) or they'd previously phished the credential and used a method that bypassed MFA somehow.

The attacker has been reading the accountant's mail for six days. They sent three wire instructions to the supplier, intercepted the supplier's replies (the rule moved them to RSS Subscriptions and marked them read), and harvested at least one successful $52,000 wire. The accountant never saw a single inbound or outbound trace of the attack.

This is the textbook post-compromise email scenario, and it relies on two things almost every attacker does after taking over a mailbox:

1. **Inbox rules** to hide the activity from the legitimate user.
2. **Auto-forwarding** (sometimes) to make sure the attacker gets a copy of every incoming message without staying continuously connected to the compromised account.

This lesson is about closing both vectors, the limits of what's possible to close, and what Panoptica365's monitoring surfaces give you.

## Two distinct controls, two different stories

Operators conflate "forwarding" and "inbox rules" because they look similar in the user interface. They're different, and they need different controls.

**Auto-forwarding to external domains** is a mailbox-level (or tenant-level) feature that copies every inbound message to an external email address. Configurable in the mailbox's settings or via an inbox rule with a "forward to" action. Microsoft tightened the default behaviour in 2020 — new tenants block external auto-forwarding by default. Older tenants, and tenants where previous admins explicitly allowed forwarding for some reason, can still have it enabled.

**Inbox rules** are user-level filters that act on incoming mail: move, delete, mark as read, mark as important, forward, redirect, set categories, run scripts (in legacy clients), and so on. Users create them legitimately for organisational reasons all the time. Attackers create them post-compromise to hide their tracks.

Auto-forwarding is the noisier signal — easier to block tenant-wide, easier to detect, harder for attackers to use without getting caught. Inbox rules are the subtler signal — impossible to block (legitimate users need them), only detectable by watching for anomalous patterns.

## Auto-forwarding — the tenant-wide block

The control surface to know is **Remote Domains** in the Exchange admin centre (Mail flow → Remote Domains; PowerShell: `Set-RemoteDomain Default -AutoForwardEnabled $false`). Each Remote Domain entry defines mail-flow behaviour for messages leaving your tenant to a specific external domain. The **Default** entry is the catch-all — every external domain you haven't explicitly configured falls under its rules. Setting Default's auto-forward property to **disabled** blocks external auto-forwarding tenant-wide except for domains you've explicitly allowed via per-domain Remote Domain entries (covered in "What can break" below).

The Panoptica365 security setting "Disable Automatic Forwarding to External Domains" operates exactly here: it pushes the Default Remote Domain to AutoForwardEnabled=$false on the customer's tenant and watches that value for drift. Somebody opening the Exchange admin centre and flipping it back to enabled — typically in response to a customer ticket like "my user can't forward their work email to their personal Gmail anymore" — fires a drift alert. You revert (or, if there's a genuine business need, apply the per-domain exception workflow below) and talk to the customer about why the block exists.

Microsoft exposes a related but separate control in the **outbound spam policy** (Defender portal → Threat policies → Anti-spam → Outbound spam) — three values, Automatic / On / Off, controlling auto-forwarding policy-wide. Some MSPs use this as belt-and-suspenders alongside the Remote Domain Default block. Panoptica365 doesn't operate on or monitor this surface today; the Remote Domain Default is the canonical control for the security setting.

**One exception worth knowing:** mail flow rules (transport rules) that redirect or BCC mail to external addresses are *not* auto-forwarding from this control's perspective. They have their own settings and their own monitoring. Lesson 8 covers mail flow rules; for now, know that the auto-forwarding controls don't catch transport-rule-based forwarding.

## Inbox rules — why they can't be disabled

Users need inbox rules. The accountant in the opening story has half a dozen legitimate ones — filtering newsletters to a folder, marking emails from her boss as important, auto-categorising client emails by project. Inbox rules are part of how email actually works as a productivity tool.

There's no tenant-wide control to disable inbox rules. There can't be — disabling them would break the legitimate productivity use case.

What there *is*:

- **Unified Audit Log entries** when inbox rules are created, modified, or deleted. Operation names include `New-InboxRule`, `Set-InboxRule`, `Remove-InboxRule`, and `UpdateInboxRules` (for Outlook desktop's rule management).
- **Microsoft Defender alerts** when an inbox rule matches suspicious patterns. Microsoft's ML flags rules that look like attacker behaviour — single-character names, redirect-to-external actions, filter-on-finance-keywords, delete-and-mark-read combinations.
- **Per-mailbox enumeration** via `Get-InboxRule -Mailbox user@domain.com` in Exchange Online PowerShell. Operators can run this manually; Panoptica365 surfaces it for the whole tenant.

The defensive posture for inbox rules is **detection, not prevention**. You can't stop users from creating rules. You can monitor for the rules attackers create.

## The attacker rule patterns to watch for

After a decade of M365 BEC investigations, the same rule shapes show up across thousands of incidents. Train yourself and your operator team to spot them.

**The single-character name.** Rules named `.` (period), `,` (comma), `..` (two periods), ` ` (single space), or a Unicode zero-width character. The attacker doesn't want the user to notice the rule exists in their rules list. The shorter and weirder the name, the higher the suspicion.

**The keyword filter on finance terms.** Conditions checking for `wire`, `payment`, `transfer`, `invoice`, `account`, `bank`, `supplier`, `vendor`, plus the names of specific people in the finance chain (CFO, controller, accounting). Combined with a hide-from-user action, this is the BEC follow-on rule.

**The hide-action combination.** Actions that move messages to obscure folders (`RSS Subscriptions`, `Junk`, `Conversation History`, `Notes`, `Sync Issues`), mark them read, and/or delete them. Legitimate rules rarely combine "move to obscure folder" with "mark as read" with "delete after a few days." Attacker rules do.

**The external redirect.** Inbox rules with a "forward to" or "redirect to" action where the destination is an external email address. This is auto-forwarding via inbox rule, and the Remote Domain Default block above mostly catches it. But some attackers use redirect-with-modification (e.g., redirect via a mail flow rule) to evade the block.

**The "delete bounce notifications" rule.** Conditions that match common Non-Delivery Report sender patterns or subject lines like "Undeliverable" or "Mail Delivery Failure." The attacker is sending wire-fraud emails and doesn't want bounce-backs reaching the legitimate user.

**The CEO / controller reply suppressor.** Rules that move incoming messages from specific high-value senders (the CEO, the customer's primary contact, the finance director) to obscure folders. Used when the attacker has hijacked an outbound thread and wants to prevent the legitimate user from seeing the recipient's responses.

When any of these patterns appears in a customer's mailbox rules and the user can't explain it, treat the mailbox as compromised. Reset credentials, revoke sessions, audit recent sent items, check the Unified Audit Log for the past 14 days, and start a proper incident-response workflow.

## What Panoptica365 sees

The Inbox Rules monitoring is one of Panoptica365's most useful surfaces on the Exchange side. It's also deliberately simple — just enough structure to make the rules scannable, no extra ceremony.

**The Inbox Rules panel.** One panel, two collapsible sections:

- **Forwarding Rules (Forward or Redirect Mail).** A flat table showing every rule in the tenant that forwards or redirects mail. Columns: User, Rule name, Target (the destination address), Type (EXTERNAL or Internal). External targets are visually flagged. Count badge in the section header shows the total. This is the high-signal view — every row is worth a look, because external forwarding is rare in legitimate workflows and EXTERNAL targets specifically are the ones attackers create.
- **All Inbox Rules (Every Enabled Rule, By User).** A flat table grouped by mailbox owner, showing every enabled inbox rule across the tenant. Columns: User, Rule name, Actions (a short description like "Move to folder · Stop processing" or "FORWARD → external `address`"). Count badge shows the total. This is the scroll-and-scan view — most rows are mundane productivity rules, and what you're looking for is the suspicious ones (single-character names, finance keywords, hide-action combinations).

There's no sorting, no filtering, no search box. The workflow is to scroll through the lists with eyes calibrated for the attacker patterns above. The trade-off Panoptica365 makes here: instead of a feature-heavy data explorer that operators would have to learn, it's a simple readable list optimised for human-eye scanning.

**Drift on the "Disable Automatic Forwarding to External Domains" security setting.** Panoptica365 watches the Default Remote Domain's AutoForwardEnabled property. If someone flips it from disabled back to enabled — typically via the Exchange admin centre's Remote Domains UI — the drift detector fires.

**UAL-based alert evaluators.** Panoptica365's alert engine includes evaluators that watch the Unified Audit Log for suspicious inbox rule creation patterns. When a match fires, the alert flows through the standard pipeline (dashboard, email notification, attribution to the customer).

What Panoptica365 does *not* surface in the dashboard: per-mailbox rule history (deltas over time), per-mailbox forwarding-state history, the raw UAL events themselves, sort/filter/search on the inbox rules tables. For deeper forensic work, drill into the Microsoft 365 Defender portal's audit log search or the Exchange admin centre.

## What can break

**Legitimate forwarding to specific business partners.** Real business workflows do involve forwarding to named external domains — a customer routing finance-related emails to their external accountant's company, a customer forwarding certain support requests to a third-party vendor, a customer mirroring specific themed mail to a consultant's firm. The discipline is not to weaken the tenant-wide block; it's to add a **per-domain exception via Remote Domain rules** in Exchange.

In Exchange admin centre: Mail flow → Remote Domains. The Default entry catches everything you haven't explicitly configured — leave its auto-forward setting off (this is what the Panoptica365 security setting pushes). Then create a specific Remote Domain entry for each external domain where the customer has a documented forwarding workflow — `accountant-firm.com`, `vendor-name.com`, `consultant-co.com` — and enable auto-forwarding for those named domains only.

Critical distinction: per-domain exceptions are for **specific named business-partner domains**, never for generic consumer providers. A user who wants to forward their work email to their personal Gmail / Hotmail / Outlook.com / Yahoo / iCloud account is the exact case the tenant-wide block exists to prevent. That's not a business workflow; it's a personal convenience that puts corporate data in attacker-reachable inboxes and breaks both the BEC defence and most data-residency expectations. Route those users to delegated access, a shared mailbox, or signing into their work email on their phone's Outlook app instead — not a Remote Domain entry for gmail.com.

Same discipline as the trusted-senders pattern in lesson 2: per-named-partner exceptions are tractable; blanket-domain exceptions are foot-cannons.

**Helpful inbox rules getting flagged as suspicious.** A user creates a perfectly legitimate rule to clean up newsletter clutter, and the Panoptica365 alert engine flags it because it matches a generic "hide messages" pattern. Triage these as you would any false positive: confirm the rule with the user, document it, move on. Over time, the alert engine's evaluators get tuned to the customer's normal.

**Legacy connector-based mail flows.** Some customers have legacy Exchange Online connectors that route mail through a third-party gateway. Those gateways occasionally inject forwarding-like behaviour. Auditing connectors during pre-flight (lesson 1) catches most of this; if a connector-based forward pattern surfaces later, the fix is at the connector, not the mailbox.

## What this means for the operator

Three takeaways.

**Block external auto-forwarding tenant-wide; make per-domain exceptions where they're justified.** Disabling auto-forward on the Default Remote Domain is the single highest-leverage control on the post-compromise blast radius. When a customer has a real business reason to forward to a named partner — accountant, consultant, vendor — add a per-domain Remote Domain entry for that specific external domain. When the request is for forwarding to a consumer provider (gmail.com, hotmail.com, etc.), route the user to delegated access, a shared mailbox, or signing into their work email on their phone instead — not a Remote Domain exception.

**You can't disable inbox rules, only watch for the attacker patterns.** The single-character names, the finance-keyword filters, the hide-action combinations — train your operator team to recognise these on sight. By the time you see them, the mailbox is already compromised; the speed of detection determines whether you contain the attack at $10K or $100K.

**Panoptica365's Inbox Rules panel is the daily operator surface.** Two sections (Forwarding Rules, All Inbox Rules) in one view. Scan them when a customer reports anything unusual (a missing email, a denied delivery, a confused supplier). The patterns are visible if you look. The cost of looking is low. The cost of not looking is the wire-fraud incident in the opening story.

## What's next

- **Lesson 6: Mailbox auditing.** The Strict mailbox audit posture, the new-mailbox drift example, and what mailbox audit gives you for post-incident forensics.
- **Lesson 7: Quarantine policies and user release.** Who can release what; the BEC follow-on risk of self-released phishing.

For now: open the customer's Inbox Rules panel in Panoptica365. Read down the list. Look for the patterns. If anything matches, drop into the mailbox in Exchange admin centre, confirm with the user, and start the incident-response workflow if the user can't explain it. The accountant in the opening story would have lost less money if her MSP had been doing this every Monday morning.

---

*Sources for the data points in this lesson — Remote Domain auto-forward settings reference ([Microsoft Learn — Set-RemoteDomain](https://learn.microsoft.com/en-us/powershell/module/exchange/set-remotedomain)); blocking external auto-forwarding overview ([Microsoft Learn — External email forwarding](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-external-email-forwarding)); outbound spam policy auto-forwarding controls (Microsoft's related surface) ([Microsoft Learn — Outbound spam policies](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-configure)); inbox rule manipulation as a post-compromise indicator ([Microsoft Learn — Detect and respond to suspicious inbox rules](https://learn.microsoft.com/en-us/defender-xdr/alert-grading-suspicious-inbox-manipulation-rules)); Unified Audit Log inbox rule operation names ([Microsoft Learn — UAL search](https://learn.microsoft.com/en-us/purview/audit-log-search)); Microsoft Graph messageRules resource type ([Microsoft Learn — messageRules](https://learn.microsoft.com/en-us/graph/api/resources/messagerule)).*
