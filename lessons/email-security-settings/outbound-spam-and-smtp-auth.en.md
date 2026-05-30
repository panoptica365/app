---
title: "Outbound spam and SMTP AUTH — controlling the blast radius when the customer is the attacker"
subtitle: "Outbound sending limits, Restricted Users auto-response, and disabling legacy SMTP AUTH to contain a compromised mailbox fast."
icon: "send"
last_updated: 2026-05-29
---

# Outbound spam and SMTP AUTH — controlling the blast radius when the customer is the attacker

A small accounting firm's senior partner gets phished at 7:14 AM on a Wednesday morning. AiTM-style: she signs into what looks like the Microsoft sign-in page on her phone before her first coffee. By 7:22, the attacker has the session cookie and is logged into her mailbox.

At 7:35 the attacker starts sending. The script is automated and ambitious. The partner has 1,847 contacts in her address book — clients, vendors, colleagues, friends, family, accountant-network mailing lists. The attacker sends each one an identical message: "Sorry for the urgency — please review this confidential file: [link to a credential-harvester branded as the firm]." 1,847 outbound messages over the course of about ninety minutes.

At 8:53 AM the attacker hits an outbound message limit. The customer's tenant flips the partner's account into Restricted Users state. Outbound mail from her mailbox stops. An alert email goes to the customer's IT contact (the MSP) saying "User X has been restricted from sending outbound mail due to suspected compromise."

The MSP's on-call sees the alert at 8:54 AM. By 9:10 they've revoked sessions, reset credentials, confirmed the compromise, locked the account, and started incident response. The damage at this point: roughly 1,800 phishing emails sent. Bad — but bounded. Roughly 150 of the recipients clicked the link (typical phishing click-rate); roughly 25 entered credentials (typical follow-through rate). The MSP spends a long Wednesday running follow-on incident response with those recipients' organisations and IT teams.

Now imagine the same scenario without the outbound limit. The attacker keeps sending. By the time anyone notices — perhaps that evening, when the partner gets back from her morning client meetings and checks her sent folder — the attacker has sent 18,000 messages. The customer's primary domain has been listed on three major spam blocklists. Microsoft has tenant-suspended outbound mail for the entire organisation. The MSP spends the next week getting the customer off blocklists, restoring deliverability for the whole tenant, and explaining to the 18,000 recipients' IT teams why they got phished from a now-tainted domain.

This is the post-compromise blast radius problem, and the outbound spam policy is the cap on it.

## Microsoft's outbound spam policy — what it controls

The outbound spam policy in Defender (Threat policies → Anti-spam → Outbound spam) governs what happens when a mailbox in the tenant is sending more outbound mail than its baseline should produce. Three threshold controls:

- **External message limit per hour.** How many messages to recipients outside the organisation can a single mailbox send in an hour. Microsoft's default is 500. Most legitimate mailboxes never hit this; compromised mailboxes running phishing scripts hit it in twenty minutes.
- **Internal message limit per hour.** How many messages to internal recipients per hour. Default 1000.
- **Daily message limit per mailbox.** Total messages per day across internal and external. Default 10,000 for most tenants.

Three action options when a limit is exceeded:

- **Alert admins only.** Notifications go out; the user keeps sending. Useful for visibility-only configurations; useless as a blast radius control.
- **Restrict the user from sending email.** The user gets added to a Restricted Users list. Outbound mail from their mailbox is blocked tenant-wide. They can still receive mail; they can still sign in; they just can't send.
- **No action.** The default for some older tenants. Microsoft tightened this in newer tenants but inherited configurations can still be at No action.

The protective setting is **Restrict the user from sending email**, with alerts going to the customer's IT contact (typically the MSP's shared inbox). When triggered, the alert is the early-warning signal that an account is likely compromised; the restriction is the cap on how much damage gets done before the operator can respond.

## The 24-hour auto-release — friction by design

When a user is restricted, they stay restricted until one of two things happens:

1. **An admin manually removes them from the Restricted Users list** (Defender portal → Email & collaboration → Review → Restricted users; or via PowerShell with `Remove-BlockedSenderAddress`).
2. **The 24-hour auto-release fires** and Microsoft automatically removes them.

The 24-hour auto-release is the safety net for false positives. If a legitimate high-volume sender hits the limit, they're not stuck offline forever — they wait until the next day. For genuine compromises, the restriction holds for the time the MSP needs to investigate; for false positives, it self-resolves.

The Panoptica365 security setting "Configure Anti-Spam Outbound Policy (Restrict Compromised Accounts)" pushes this configuration: the action set to "Restrict the user," alert recipients pointed at the right address, the 24-hour auto-release engaged. The drift detector watches whether the action stays set to Restrict. Someone changing it to "Alert admins only" — typically in response to a false-positive ticket — fires the drift alert.

## Threshold tuning — the legitimate-volume conversation

The default thresholds (500 external/hour, 1000 internal/hour, 10000 daily) are generous for most SMB tenants. Some legitimate senders do hit them, though, and tuning needs to be a deliberate conversation:

- **Marketing / mailing-list senders.** The customer's CRM or marketing platform sending high-volume legitimate campaigns from a tenant mailbox.
- **Customer service automation.** Auto-responders, ticket notifications, account confirmations sent from a service mailbox.
- **Internal newsletters.** A communications team sending a weekly all-staff update to 500 internal recipients.

For each, the right answer is usually *not* "raise the global threshold." It's either:

- **Move the legitimate high-volume sender to a different transport mechanism** (Microsoft has dedicated bulk email services; a third-party email platform via authenticated connector; etc.) so the tenant mailbox isn't doing the sending.
- **Create a custom outbound spam policy** scoped to the specific mailbox (or group) with higher thresholds, while keeping the default policy strict for everyone else.

Don't raise the threshold for the whole tenant just because one mailbox has a legitimate use case. That makes the blast radius cap worthless for the other 31 mailboxes in the tenant.

## SMTP AUTH submission — the legacy back door

Separately from the outbound spam policy, M365 has another vector worth closing: **SMTP AUTH submission**.

SMTP AUTH submission is the protocol that lets an application or device authenticate to `smtp.office365.com:587` with a username and password and send mail through M365 as that user. It's been around forever. Legacy multi-function printers use it to scan-to-email. Old line-of-business applications use it to send notifications. Custom scripts use it to send report emails.

It's also a credential-stuffing dream. SMTP AUTH submission uses **basic authentication** — username and password, no MFA, no Conditional Access in most configurations. An attacker with the user's password (from a credential-stuffing list or a phish that didn't get the session cookie) can authenticate to SMTP AUTH and send mail as the user, bypassing all the modern auth defences.

Microsoft has been deprecating Basic Auth for years across all the legacy protocols (IMAP, POP, EWS, MAPI/RPC, Remote PowerShell). SMTP AUTH submission was the last holdout because so many legacy devices and apps still depend on it. As of 2025–2026, Microsoft has been disabling SMTP AUTH submission by default for new tenants, but older tenants and tenants that explicitly enabled it can still have it active.

The Panoptica365 security setting "Disable Basic Auth for SMTP AUTH Submission" pushes `Set-TransportConfig -SmtpClientAuthenticationDisabled $true` at the tenant level. The drift detector watches whether it stays disabled.

## The legacy-use-case conversation

When you push the tenant-wide block, you may break legitimate workflows. Find them during pre-flight (lesson 1's "audit current state" work), not after deployment.

Common legacy SMTP AUTH users:

- **Multi-function printers** configured years ago for scan-to-email. The fix is usually to reconfigure the printer to use Microsoft's *direct send* mechanism (unauthenticated SMTP from the printer's internal IP via a tenant connector) or to upgrade the printer firmware to support modern auth.
- **Legacy LOB apps** sending email notifications. The fix depends on the vendor — modern versions usually support OAuth-based SMTP submission via Microsoft Graph; older versions may need a per-app password (less safe) or a replacement.
- **Custom scripts.** The fix is to rewrite to use Microsoft Graph's `sendMail` API or Azure Communication Services. Scripts are usually one-off and easy to update.
- **Specific service mailboxes the customer can't easily migrate.** As a last resort, SMTP AUTH submission can be enabled per-mailbox while remaining disabled tenant-wide (`Set-CASMailbox <user> -SmtpClientAuthenticationDisabled $false`). Document the exception; review it annually; plan the eventual migration.

Avoid the tempting shortcut of leaving SMTP AUTH enabled tenant-wide just because one printer needs it. That re-opens the back door for everyone. The per-mailbox override exists for exactly this case.

## What Panoptica365 sees

Two security settings on the Exchange-category list:

**"Configure Anti-Spam Outbound Policy (Restrict Compromised Accounts)."** Panoptica365 watches the outbound spam policy's action property. The recommended value is "Restrict the user from sending email" with the 24-hour auto-release engaged. Drift fires if the action changes or the alerts get disabled.

**"Disable Basic Auth for SMTP AUTH Submission."** Panoptica365 watches the tenant transport config's `SmtpClientAuthenticationDisabled` property. The recommended value is `$true` (disabled). Drift fires if SMTP AUTH gets re-enabled tenant-wide.

Beyond drift, the **alert engine** ingests Microsoft's outbound-spam restriction events when they fire — a user-restricted event is one of the highest-signal compromise indicators Microsoft surfaces, and Panoptica365 forwards it through the standard alert pipeline so it doesn't get lost in Microsoft's notification flood.

What Panoptica365 does *not* surface in the dashboard: per-mailbox SMTP AUTH activity history, a Restricted Users browser, a per-mailbox outbound rate-limit history. Those live in the Defender portal's restricted users review surface and in Microsoft's audit logs.

## What can break

**Legitimate sender hits the outbound limit and gets restricted.** Sales person on a big campaign day; marketing person sending a one-off newsletter from their own mailbox; communications person sending the annual employee letter. The user calls in panicked. The fix is to either remove them from Restricted Users manually (and warn them about the proper bulk-mail mechanism) or to wait out the 24-hour auto-release. Tune for the customer's legitimate-volume patterns during onboarding.

**Printer stops scanning-to-email after SMTP AUTH disable.** Common. The fix is direct-send via tenant connector (preferred), printer firmware upgrade to modern auth (works for newer models), or per-mailbox SMTP AUTH override for the printer's service account as a last resort.

**Backup-job email notifications stop working.** Some legacy backup software uses SMTP AUTH for status emails. Modernise via OAuth-based SMTP (if vendor supports it) or migrate the notification mechanism.

**False-positive restriction during a legitimate spike.** A new product launch, a major customer announcement, an emergency communication — these can briefly look like compromised-account behaviour. Whitelist the specific scenario, manually remove from Restricted Users, document in the runbook for next year.

## What this means for the operator

Three takeaways.

**The outbound limit is the blast radius cap.** When a compromise happens — and it will eventually happen on every customer — the difference between 1,800 outbound phish and 18,000 is the outbound spam policy's Restrict action. Set it. Confirm the alerts route to your shared inbox. The 24-hour auto-release is your safety net for false positives; it's not a reason to weaken the action.

**SMTP AUTH submission is the legacy auth pathway that survived the others — disable it.** Modern auth has been the standard for years; SMTP AUTH is the last hole. Disable it tenant-wide, identify the legacy workflows that need exceptions during pre-flight, fix them properly (direct send, OAuth submission, app modernisation), and keep per-mailbox overrides documented and time-bounded.

**The Restricted Users alert is the highest-signal compromise indicator Microsoft surfaces.** When it fires, treat it as a credible compromise until proven otherwise. Revoke sessions, reset credentials, audit recent activity, check inbox rules and transport rules, look at the sent folder, identify what was sent. The customer's accounting partner in the opening story keeps her customer relationships because her MSP responded inside the 30-minute window the restriction bought.

## What's next

- **Lesson 10: Preset security policies and operating email at scale.** The Standard / Strict bundles that bring most of card 5's controls together in one configuration, the drift-detection model across the whole card, and the annual review cadence.

For now: open the customer's outbound spam policy in the Defender portal. Verify the action is set to "Restrict the user from sending email" with admin alerts enabled. Verify SMTP AUTH submission is disabled at the tenant level (`Get-TransportConfig | Select SmtpClientAuthenticationDisabled` should return `True`). Identify and fix any per-mailbox SMTP AUTH exceptions that aren't documented. The partner in the opening story doesn't have her phone ringing all day on a Wednesday afternoon because the cap held.

---

*Sources for the data points in this lesson — Microsoft Learn on outbound spam policies and message limits ([Microsoft Learn — Outbound spam policies](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-configure)); Restricted Users review and removal workflow ([Microsoft Learn — Restricted users](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-restore-restricted-users)); SMTP AUTH submission overview and deprecation ([Microsoft Learn — Authenticated SMTP submission](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission)); Set-TransportConfig SmtpClientAuthenticationDisabled reference ([Microsoft Learn — Set-TransportConfig](https://learn.microsoft.com/en-us/powershell/module/exchange/set-transportconfig)); direct send for printers and scanners ([Microsoft Learn — Submitting email using direct send](https://learn.microsoft.com/en-us/exchange/mail-flow-best-practices/how-to-set-up-a-multifunction-device-or-application-to-send-email-using-microsoft-365-or-office-365#option-2-send-mail-directly-from-your-printer-or-application-to-microsoft-365-or-office-365-direct-send-recommended)); per-mailbox SMTP AUTH override with Set-CASMailbox ([Microsoft Learn — Set-CASMailbox](https://learn.microsoft.com/en-us/powershell/module/exchange/set-casmailbox)).*
