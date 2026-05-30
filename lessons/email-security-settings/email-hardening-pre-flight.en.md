---
title: "Email hardening pre-flight — what to know before you touch a single setting"
subtitle: "Licensing reality, pre-work inventory, and the mistakes operators make before they even start hardening email."
icon: "clipboard-check"
last_updated: 2026-05-29
---

# Email hardening pre-flight — what to know before you touch a single setting

A customer's controller gets an email from the CEO. Urgent — supplier in trouble, needs a wire of $84,000 to a new account by end of day. The controller wires it. Twelve hours later the actual CEO comes back from a flight and asks what the wire was for. The email was forged. The "supplier" was a Romanian mule account. The customer's insurance covers half. The customer's lawyer asks the MSP, politely at first and then less politely, why the email defences they're paying for didn't catch this.

The post-mortem is depressing in its specifics:

- The customer's domain had no DMARC record. SPF was set to `~all` (soft-fail), which Microsoft 365 accepted anyway because rejecting would have been "too disruptive."
- The anti-phishing policy was Microsoft's default. Impersonation protection for the CEO was not turned on. Anti-spoofing wasn't tuned.
- Safe Links was licensed (Business Premium includes Defender for Office 365 Plan 1) but had never been configured. The clickable link in the wire-instructions email was an unwrapped redirect to a credential-harvesting page.
- Quarantine release was on Microsoft's per-user default, so even if the message had been quarantined, the controller could have released it herself.
- The customer paid for all of this protection. Every month. For years.

Card 5 is about closing that gap. The customer's email environment is the single most-attacked surface in M365 — phishing, BEC, impersonation, malware, OAuth consent attacks all arrive via email — and Microsoft's defaults are tuned for compatibility, not security. The work of card 5 is taking the defences that are *available* and *paid for* and actually *turning them on, tuned correctly, with the right discipline around the human workflows*.

This lesson is the pre-flight: the licensing reality, the inventory you need before you touch a setting, what M365 ships with already-configured, and the common mistakes operators make before they even start.

## The licensing reality — what you have, what you don't

Email defence in M365 sits in three layered services. Knowing which the customer has is the prerequisite for everything else in card 5.

**Exchange Online Protection (EOP).** Free, included with any M365 mailbox licence. EOP is the anti-spam, anti-malware, connection-filtering layer. It catches the bulk of obvious spam and known malware. Every M365 tenant has it. You don't pay extra for it, but you do still have to configure it — the defaults are deliberately permissive.

**Defender for Office 365 Plan 1 (MDO P1).** Included with Microsoft 365 Business Premium, the licence almost every SMB MSP customer should be on. Adds Safe Links (URL rewriting and click-time evaluation), Safe Attachments (sandbox detonation of file attachments), real-time detections, and enhanced anti-phishing (mailbox intelligence, user impersonation protection, domain impersonation protection). This is the meaningful upgrade over EOP and the one customers are typically already paying for without realising it. Most of card 5 assumes you have P1.

**Defender for Office 365 Plan 2 (MDO P2).** Included with Microsoft 365 E5 / A5 / G5 (enterprise-grade SKUs). Adds Threat Explorer, automated investigation and response, attack simulation training, and threat trackers. Almost no SMB customers have this. We'll mention P2 features in passing where relevant; we won't dwell on them. If your customer has E5 you'll know it, and you'll want to lean on the Microsoft Learn docs for those features specifically rather than expecting card 5 to cover them in depth.

The thing to internalise: Business Premium customers have a meaningful security upgrade over Business Standard, but the upgrade only counts if you actually turn it on. The wire-fraud customer in the opening anecdote was paying for P1 the entire time. The MSP just hadn't configured Safe Links.

## What M365 ships with, already-configured

Microsoft does configure *some* email defences out of the box. The trick is knowing which ones, because they're often weaker than operators assume.

**Already on, with default values:**

- The default anti-spam inbound policy. Catches obvious spam (high spam confidence level). Bulk email threshold is set to 7 (mid-range — lets most marketing mail through). User-released quarantine is allowed.
- The default anti-malware policy. Catches known-malicious attachments by hash match. Common file extensions blocked (.exe, .bat, .cmd, and a few more).
- The default anti-phishing policy. Anti-spoofing enabled. Anti-phishing *user impersonation* protection — **not configured by default**. *Domain impersonation* protection — **not configured by default**.
- Connection filter policy. No IP allow or block list by default.
- Default DKIM. Microsoft auto-generates a DKIM key for the tenant's `onmicrosoft.com` domain only. Custom domains require manual setup.

**Not configured by default — you have to turn these on:**

- Safe Links policies. Even with the P1 licence, Safe Links is not enabled for users until you create a policy and assign it to user groups.
- Safe Attachments policies. Same — licence present, feature off until you configure.
- DMARC. Customer's DNS, customer's responsibility (or the MSP's). M365 doesn't publish DMARC records for you.
- DKIM for custom domains. The DKIM keys exist; you have to publish the CNAMEs in DNS and enable signing per domain.
- Auto-forwarding to external domains. Microsoft tightened defaults in 2020 to block this, but per-customer exception lists may still exist from migration projects.
- Outbound spam protection (custom restrictions). The default outbound policy is permissive — a compromised mailbox can send a lot of mail before tripping the default thresholds.
- Mail flow rules (transport rules). None by default.
- Mailbox audit logging in strict mode. Auditing is on by default since 2019, but the *strict* set of audited actions (the ones that catch BEC artefacts) needs explicit configuration.

The pattern: Microsoft ships the floor. The licence covers the ceiling. Card 5 is about lifting the customer's posture from the floor to the ceiling.

## Inventory — know what you're hardening

Before you touch a single setting, pull these facts about the customer's environment:

**Mailboxes.** How many? Run `Get-Mailbox` in Exchange Online PowerShell or pull the count from the Microsoft 365 admin centre. Note the breakdown:

- User mailboxes (real humans).
- Shared mailboxes (delegated access; often weakly protected and often the source of "the CEO's assistant got phished" stories).
- Resource mailboxes (rooms, equipment).
- Distribution groups and Microsoft 365 groups.

For a small customer this is 10 to 50 entities; for a medium one, 100 to 300. Either way, *write the inventory down*. You'll come back to it for the quarantine release scope, the mailbox audit posture scope, and the impersonation protection scope.

**Domains.** Every accepted domain in the tenant. The primary domain (used in user UPNs), the vanity domains (additional accepted domains the customer sends from), the legacy domains (from acquisitions or rebrands), the `onmicrosoft.com` default (the floor-level fallback). For each, note:

- Current SPF record (DNS TXT — start with `v=spf1 include:spf.protection.outlook.com -all` as the target end-state).
- Current DKIM state (enabled per domain? CNAMEs published?).
- Current DMARC record (published? `p=none` / `p=quarantine` / `p=reject`?).
- Whether the domain is used outbound from M365 at all (some legacy domains exist only to receive; those need DMARC too).

**Current mail flow.** Open the Exchange admin centre, navigate to Mail flow → Rules. Read every rule. Document the purpose. Many customers have a sediment layer of transport rules from previous admins doing previous things — old "if subject contains [URGENT] then high importance" rules, old external-recipient warnings that don't trigger any more, old executable-blocking rules made obsolete by Safe Attachments. Lesson 8 is about taming this; for pre-flight, just know what's there.

**Existing protection state.** A quick audit of the current posture using `Get-AntiPhishPolicy`, `Get-SafeLinksPolicy`, `Get-SafeAttachmentPolicy`, and `Get-HostedContentFilterPolicy` (the anti-spam policy). For each, note: is it the default Microsoft policy, or has the previous admin customised it? Custom policies in unknown states are the most common source of "we deployed Safe Links but nothing happened" tickets.

## What the customer expects

This is the soft part of pre-flight, and the part operators skip. Email defence breaks customer workflows constantly — phishing-tuned defences catch some legitimate marketing email; tightened DMARC kicks the customer's own poorly-configured marketing platform out of the inbox; aggressive Safe Attachments delays an executive's important PDF by 90 seconds. Customers feel these as friction.

Document, in the ticket or change record, before deploying:

- Who at the customer is allowed to release quarantine messages? Default-everyone is dangerous; default-admin-only is restrictive. Often the right answer is "the controller's manager plus one or two trusted people," and that needs to be communicated and configured.
- Are there senders the customer routinely receives email from that are likely to trip impersonation or anti-phishing controls? (Vendors whose domains are similar to the customer's; legitimate marketing platforms with weak DKIM; SaaS apps that send from third-party SMTP.)
- Is there a domain that *should not be hardened* yet because the customer's marketing team uses a third-party platform to send under it and hasn't fixed their SPF? (Common; this is the right scope for a separate conversation.)
- Are there compliance requirements that affect retention, legal hold, or quarantine policies? (Common in healthcare, finance, and government contracting.)

## Common mistakes operators make before they even start

Three patterns surface repeatedly:

**Assuming "Microsoft has us covered."** They don't. The defaults are the floor, not the ceiling. Auditing the current state before assuming protection exists has saved more customers than any single policy change.

**Skipping DMARC because "it's complicated."** It's not complicated, it's *involved* — there's a journey from `p=none` (observe) to `p=quarantine` to `p=reject` (enforce). Lesson 4 walks through it. Skipping DMARC is how the wire-fraud anecdote at the top of this lesson starts.

**Not auditing the customer's mail flow rules.** Three years of accumulated transport rules from previous admins is a mess. Sometimes there's a rule routing mail from `*@finance.com` to a single mailbox because of a long-forgotten merger. Sometimes there's a rule disabling Safe Links on certain inbound mail because a vendor complained. Sometimes there's a rule auto-forwarding *anything* matching a regex to an external address because someone debugged a problem in 2021 and forgot to clean up. Find these. Document them. Fix or remove them. (Lesson 8.)

## What this means for the operator

Three takeaways.

**Licensing reality is the prerequisite.** Confirm what the customer has (EOP only / MDO P1 / MDO P2) before promising any of card 5's defences. Most SMB customers have MDO P1 via Business Premium; most aren't using it.

**Default-on does not mean default-secure.** Microsoft ships a usable floor — anti-spam runs, known malware is blocked, basic anti-spoofing exists. None of it is tuned. The work of card 5 is lifting from the floor to the ceiling for each feature.

**Inventory before configuration.** Mailboxes, domains, current SPF/DKIM/DMARC, existing mail flow rules, existing custom policies. Without this list, you'll configure half a hardening pass and re-break the half you missed when a customer ticket surfaces a rule you didn't know about.

## What's next

- **Lesson 2: Anti-phishing policies.** User and domain impersonation protection, spoof intelligence, mailbox intelligence — turning Microsoft's default-off impersonation defence into something that actually catches the BEC anecdote at the top of this lesson.
- **Lesson 3: Safe Links and Safe Attachments.** The MDO P1 features customers paid for without using.
- **Lesson 4: SPF, DKIM, DMARC.** The authentication trio that would have caught the forged email in the opening story.

For now: write the inventory down, audit the current configuration, set the customer's expectations about what's about to change. The rest of card 5 builds on this foundation.

---

*Sources for the data points in this lesson — Microsoft Learn on Exchange Online Protection overview ([Microsoft Learn — EOP overview](https://learn.microsoft.com/en-us/defender-office-365/eop-about)); Defender for Office 365 service description ([Microsoft Learn — MDO service description](https://learn.microsoft.com/en-us/office365/servicedescriptions/office-365-advanced-threat-protection-service-description)); Microsoft 365 Business Premium feature list ([Microsoft Learn — Business Premium for SMB](https://learn.microsoft.com/en-us/microsoft-365/business-premium/)); preset security policies reference ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)); blocking auto-forwarding to external domains ([Microsoft Learn — External email forwarding](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-external-email-forwarding)); Set-MailboxAuditBypassAssociation and auditing baseline ([Microsoft Learn — Mailbox audit logging](https://learn.microsoft.com/en-us/purview/audit-mailboxes)).*
