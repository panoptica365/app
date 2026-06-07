---
title: "Mail flow rules and MailTips — the surgical tools and the warning lights"
subtitle: "Using Exchange transport rules to enforce policy in mail flow, and MailTips to surface risk warnings before users click Send."
icon: "scroll-text"
last_updated: 2026-05-29
---

# Mail flow rules and MailTips — the surgical tools and the warning lights

A customer's IT manager gets phished on a Friday afternoon. He's a global admin in the tenant. The attacker uses his credentials to sign into the M365 admin centre. MFA is enabled, but the attacker has captured the session cookie via Evilginx2 — the cookie satisfies the MFA-already-completed claim. The attacker has a one-hour window before the session would normally expire.

In that hour the attacker creates two transport rules:

- **Rule one** — condition: sender is `controller@customer.com`; action: BCC every message to `archive-helper@protonmail.com`. The attacker is going to silently read every outbound message the controller sends.
- **Rule two** — condition: any inbound message from outside the organisation; action: set message header `X-MS-Exchange-Organization-SkipSafeLinksProcessing` to bypass Safe Links wrapping. The attacker is going to send unwrapped phishing links to the controller from now on.

The session cookie expires. The MFA challenge fires on the next sign-in attempt and the attacker can't satisfy it. The user gets back into his account. The credentials work fine. Nothing looks wrong on the user-visible surface.

The transport rules stay in place. They're tenant-level objects. Password resets, session revocations, and MFA re-enrolments don't touch them. The controller's outbound mail gets BCC'd to protonmail.com for the next three weeks. The customer is paying the attacker to silently read everything the finance director writes, and the customer doesn't know it.

This is the abuse pattern that makes transport rules a special concern. Inbox rules are per-mailbox, visible to the user, visible in the Panoptica365 Inbox Rules panel (lesson 5). Transport rules are *tenant-level*, invisible to end users, and require a deliberate operator scan to surface.

This lesson is about what transport rules can legitimately do, the abuse patterns to watch for, and the MailTips configuration that gives users the moment-of-truth warning before they send something they'd regret.

## What mail flow rules can do — the legitimate use cases

Transport rules (Microsoft's branding for mail flow rules) are condition-action policies that run on every message flowing through the tenant. They live in Exchange admin centre → Mail flow → Rules and can also be managed via PowerShell (`New-TransportRule`, `Get-TransportRule`, `Set-TransportRule`, `Remove-TransportRule`).

Conditions can match on essentially anything: sender, recipient, subject, body content, message headers, attachment names or types, message size, sender's domain, whether the recipient is internal or external, time of day. Actions are similarly broad: block, redirect, BCC, forward, modify headers, prepend the subject, add a disclaimer, apply a compliance label, set the message classification, route through a specific connector.

For SMB operators, the legitimate use cases cluster into a small number of patterns:

**External-sender warnings.** A rule that prepends `[EXTERNAL]` to the subject of any inbound message from outside the organisation, or that adds a yellow disclaimer banner at the top of the body. The "your colleague sent this from outside" warning. Worth deploying for most customers; it's the cheapest user-visible signal that a message isn't from the trusted internal directory.

**Executable attachment blocks.** Even with Safe Attachments in place, some customers want a hard block on specific high-risk file extensions (`.exe`, `.bat`, `.scr`, `.js`, `.vbs`). A transport rule that rejects messages with those attachments is a defence-in-depth layer on top of Safe Attachments' sandbox.

**Tenant blocklist enforcement.** Specific sender domains that should never reach the tenant — known scam patterns, vendors who've gone rogue, ex-employees attempting impersonation. A rule that drops or quarantines messages from those domains.

**Disclaimer / footer for compliance.** Some regulated industries require specific text on outbound mail (legal disclaimers, confidentiality notices). Transport rules add the disclaimer at the gateway, so users don't have to remember.

**Internal-only distribution lists.** A rule that blocks external senders from delivering to specific distribution groups (e.g., `all-employees@customer.com` shouldn't be reachable from outside).

**Auto-classification for sensitivity labels.** Rules that match certain keywords or attachment patterns and apply Microsoft Information Protection labels for downstream DLP.

Each is legitimate. None of these should make the customer reflexively turn on Microsoft's defences elsewhere — they're additive controls.

## The attacker abuse patterns — what to watch for

The opening anecdote covered two patterns. The full taxonomy is wider.

**The BCC-out rule.** Condition: sender is a high-value mailbox (CFO, CEO, finance director, legal). Action: BCC to an external attacker-controlled address. Silent persistent exfiltration. Survives password resets.

**The header-strip rule.** Action: modify or set a message header to bypass downstream controls. Stripping `X-MS-Exchange-Organization-SkipSafeLinksProcessing` to evade Safe Links wrapping; modifying authentication-related headers; suppressing spam scoring; adding fake SCL (Spam Confidence Level) overrides.

**The bounce-suppression rule.** Condition: subject contains "Undeliverable" or `Mail Delivery Failure` patterns; action: silently delete. The attacker is sending wire-fraud emails from the compromised mailbox and doesn't want bounce-backs reaching the user.

**The redirect-all rule.** Condition: any inbound mail to a specific recipient; action: redirect to an attacker-controlled mailbox. More aggressive than BCC because the original recipient never sees the message at all.

**The selective deletion rule.** Condition: sender matches a high-value partner (the customer's biggest client, an oversight body, a specific vendor); action: delete from delivery or move to a folder. Used to suppress communications the attacker doesn't want surfaced.

**The slow-walk rule.** Condition: sender matches a specific person; action: delay delivery by N hours. Used to delay the legitimate owner's emails so the attacker's spoofed messages arrive first.

**The Safe Links / Safe Attachments bypass.** Conditions that match specific inbound senders and actions that set the message to bypass MDO scanning. The attacker is sending malicious content from a specific external address and wants to evade the defences.

The shared characteristic: the attacker is using transport rules to make their post-compromise activity *invisible to the user* and *survivable across credential resets*. The defence is detection — periodic operator review of the transport rules in the tenant, plus alerting on suspicious rule creation events.

## The hygiene work — auditing existing rules

Most customer tenants accumulate transport rule cruft. Three years of changes from previous admins, migrations that brought in rules from acquired domains, vendor-specific rules created for problems that no longer exist. The pre-flight inventory work from lesson 1 includes "audit existing transport rules"; this is the section that walks through the audit.

For each existing transport rule, ask:

- **What does it do?** Read the conditions and actions carefully. Plain-English summary in one line.
- **Why does it exist?** Look at the rule's notes, the creation date, the modifying admin. If the rule has no notes, no recent modification, and was created by an admin who's no longer at the customer, that's a red flag for a stale rule.
- **Is it still needed?** Test what happens if it's disabled (most tenants let you put a rule into audit mode or disable temporarily). If nothing breaks for a week, the rule is dead weight.
- **Does it weaken any defence?** Rules that bypass Safe Links, bypass anti-spam, bypass anti-phishing, or BCC anywhere external need explicit justification.

Document each surviving rule with its purpose. Remove the cruft. Going forward, every new transport rule should have a documented purpose, a creation reason in the rule notes, and an owner who can speak to why it exists.

## MailTips — the warning lights

Separately from transport rules, M365 has **MailTips** — the small infobar warnings Outlook shows users when they're composing or replying to a message. The most consequential for BEC defence is the **External Recipients** tip, the yellow bar that says "You're sending this email to recipients outside your organisation" with the external domain listed.

For a user about to wire-fraud-respond to a forged "CEO" email coming from a Gmail-with-display-name attacker, that yellow bar is sometimes the moment of pause that prevents the wire. Not always. But it's free, it's user-visible, and it costs nothing operationally.

Other MailTips include:

- **Out-of-office** — recipient has an auto-responder set.
- **Mailbox full** — recipient's mailbox can't receive new mail.
- **Large audience** — the recipient list exceeds a configurable threshold.
- **Moderated recipient** — the message will require moderation before delivery.
- **Restricted recipient** — the recipient is configured to reject certain senders.
- **Reply-all to large audience** — pressing Reply All would send to many people.

For a typical SMB customer, the right configuration is **all tips enabled, including the External Recipients tip**. The Panoptica365 security setting "Enable MailTips (All Tips + External Recipients)" pushes this configuration and watches for drift. If a customer's admin disables MailTips — sometimes done in response to a "the yellow bar is annoying" user complaint — the drift signal is the early warning. You re-enable, talk to the user about why the warning exists, and move on.

The PowerShell underneath: `Set-OrganizationConfig -MailTipsAllTipsEnabled $true -MailTipsExternalRecipientsTipsEnabled $true`. The threshold for the large-audience tip can be adjusted (`MailTipsLargeAudienceThreshold`) — Microsoft's default of 25 is usually fine for SMB.

## What Panoptica365 sees

**Drift on the "Enable MailTips (All Tips + External Recipients)" security setting.** Panoptica365 watches the organisation configuration's MailTips properties. Disabling MailTips at the tenant level fires the drift alert; reapply restores the configuration.

**Defender XDR alerts on suspicious transport rule creation.** When MDO surfaces a high-severity event related to a transport rule being created with characteristics matching attacker patterns (external BCC, header bypass, Safe Links bypass), the alert flows into Panoptica365's alert engine through the standard pipeline.

What Panoptica365 does *not* surface in the dashboard: a per-tenant transport rule browser, a rule-by-rule diff viewer, a hygiene-audit workflow. The audit work happens in the Exchange admin centre or via PowerShell. Panoptica365's role here is the drift on the MailTips setting and the alert pipeline for suspicious rule creation; the rule-by-rule audit is operator territory.

## What can break

**Customer-created transport rules that conflict with Panoptica365-pushed settings.** A customer has an old rule that disables MailTips for a specific mailbox (maybe an automation account). When Panoptica365 enforces MailTips tenant-wide, the customer's old behaviour breaks. The fix is to identify the legitimate need (if any) and update the rule explicitly; not to weaken the tenant-wide MailTips configuration.

**External-sender disclaimer banners getting double-stamped.** Some customer tenants already have an external-sender rule and add another one without disabling the first. Users see two yellow banners. The fix is to consolidate into one rule.

**Legitimate executable attachments getting blocked by extension rules.** A vendor sends a `.exe` installer for a specific tool the customer uses. The transport rule blocks it. The fix is a sender-scoped exception (allow `.exe` from `vendor.com` only) rather than removing the executable block entirely.

**MailTips disabled per-user.** Some users have MailTips disabled at their mailbox level (overriding the tenant default). Audit per-user OWA mailbox policies during pre-flight to catch this.

## What this means for the operator

Three takeaways.

**Transport rules are the most powerful and least-visible configuration object in M365.** They're tenant-level, they survive password resets, they can bypass downstream defences, and most users have no way to see them. Audit them on every customer onboarding. Document every surviving rule with its purpose. Treat new transport rule creation as a higher-trust action than creating a user mailbox.

**The attacker patterns are recognisable.** External BCC, header bypass, bounce suppression, selective deletion — train your operator team to spot these in customer rule lists. The shared characteristic is that the rule's effect is invisible to the user being targeted. Anything matching that shape gets investigated.

**MailTips are free, user-visible, and worth enabling everywhere.** The External Recipients tip is the moment-of-truth warning that pauses a user about to send to an attacker domain. Enable all tips at the tenant level. Push back gently when users complain about the yellow bar — it's protecting them from the wire fraud you don't want to spend Saturday handling.

## What's next

- **Lesson 9: Outbound spam and SMTP AUTH.** The post-compromise blast radius controls — what happens when a customer's mailbox becomes the one sending the phish.
- **Lesson 10: Preset security policies and operating email at scale.** The Standard / Strict bundles, the drift-detection model across all of card 5, and the annual review cadence.

For now: open the customer's transport rules in the Exchange admin centre. Read every rule. Note what each one does and why. Remove the cruft. While you're there, verify MailTips is enabled tenant-wide (or check Panoptica365's drift state on the setting). The customer's IT manager in the opening story doesn't get the BCC rule planted on his watch.

---

*Sources for the data points in this lesson — Microsoft Learn on Exchange Online transport rules ([Microsoft Learn — Mail flow rules in Exchange Online](https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/mail-flow-rules)); New-TransportRule and rule conditions / actions reference ([Microsoft Learn — Mail flow rule actions](https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/mail-flow-rule-actions)); Safe Links bypass via X-MS-Exchange-Organization-SkipSafeLinksProcessing header ([Microsoft Learn — Skip Safe Links via mail flow rules](https://learn.microsoft.com/en-us/defender-office-365/safe-links-policies-configure)); MailTips overview and tenant configuration ([Microsoft Learn — MailTips in Exchange Online](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/mailtips/mailtips)); Set-OrganizationConfig MailTips parameters reference ([Microsoft Learn — Set-OrganizationConfig](https://learn.microsoft.com/en-us/powershell/module/exchange/set-organizationconfig)).*
