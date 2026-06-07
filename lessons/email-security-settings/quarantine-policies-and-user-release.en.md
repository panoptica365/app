---
title: "Quarantine policies and user release — where good defaults go to die"
subtitle: "Locking down quarantine release permissions so end users can't single-handedly release high-confidence phish into their own inboxes."
icon: "inbox"
last_updated: 2026-05-29
---

# Quarantine policies and user release — where good defaults go to die

A customer's CEO assistant gets a daily quarantine notification email from Microsoft. Subject: "You have 3 quarantined messages." The body lists three messages with sender, subject, and a Release button next to each.

One of the three is from someone she doesn't recognise, with a subject like "Your DocuSign envelope is ready for signature." She wasn't expecting a DocuSign envelope. But the CEO does sign things all the time, and she handles his calendar, and maybe this is something he needs to see, and she doesn't want to look like the assistant who blocked something important from getting through. She clicks Release.

The message arrives in her inbox. She opens it. She clicks the DocuSign-branded link. The link goes to a credential-harvester running on a freshly-registered domain with a valid Let's Encrypt certificate. She types the CEO's credentials, because the CEO had asked her to handle DocuSign for him, and she has the password. The attacker captures both the credential and the session cookie. Twelve minutes later the attacker is inside the CEO's mailbox.

The assistant did exactly what Microsoft's default quarantine notification *invited her to do*. She had a Release button. She used it.

This is the BEC follow-on vector that gets less attention than it deserves: even when Defender successfully quarantines a phishing email, the customer's own user can release it back into the inbox with one click. The defence against the phish exists; the defence against the user undoing the defence is what this lesson is about.

## The four (or five) quarantine categories

Microsoft classifies quarantined messages into distinct categories, each with its own default release rules. Knowing the categories matters because the right configuration is *category-specific*.

- **Spam** (low-confidence spam) — messages Microsoft suspects are spam with moderate confidence. Default: users can release with notification.
- **High-confidence spam** — Microsoft is more certain. Default: users can release with notification.
- **Bulk** — newsletter-style mass mail. Default: users can release with notification.
- **Phishing** — Microsoft suspects this is a phishing attempt. Default: admin must release.
- **High-confidence phishing** — Microsoft is highly confident. Default: admin must release; the message can't be released by users.
- **Malware** — file attachment or link matched a malicious pattern. Default: admin must release.
- **Spoof** — sender authentication (SPF/DKIM/DMARC) failed in a way that suggests sender impersonation. Default varies by tenant configuration.

The defaults are reasonable for the high-confidence categories (admin must release) and *dangerous* for the lower-confidence ones (users can release). The opening anecdote happened because the assistant got a message classified as Phishing (not High-confidence) with the default older configuration that let users release lower-confidence phish — and Microsoft has tightened defaults since, but customer tenants that were configured years ago may still carry the looser settings.

## Quarantine policies — the configuration object

A **quarantine policy** in M365 is the object that defines what users are allowed to do with quarantined messages. Microsoft ships three preset policies; you can create custom ones.

The presets:

- **AdminOnlyAccessPolicy** — users get no release capability at all. They can view the quarantined messages (if notification is enabled) but cannot release them. The admin is the only one who can. The strictest posture.
- **DefaultFullAccessPolicy** — users can request release (admin still approves) and can preview messages. No notifications.
- **DefaultFullAccessWithNotificationPolicy** — same as DefaultFullAccessPolicy but with quarantine notifications enabled. Microsoft's most-permissive default.

Custom policies let you mix-and-match: enable specific actions (request release, preview, block sender), specify whether notifications are sent, and choose how aggressive the notification cadence is.

The configuration that matters for SMB hardening: **apply AdminOnlyAccessPolicy to the dangerous categories** (Phishing, High-confidence phishing, Malware, Spoof). Users can never release messages in those categories without the operator's approval. For the lower-confidence categories (Spam, Bulk), the more permissive DefaultFullAccessWithNotificationPolicy is defensible — those are usually marketing email or noise, and giving users self-service for those reduces help-desk load.

## Quarantine notification cadence

Separate from the policies themselves, M365 controls how often users get the "you have quarantined messages" digest email. The notification frequency can be set per quarantine policy (in newer configurations) or via a global setting (in older ones).

Common cadences:

- **Daily** — the default. One email per day with the day's quarantined messages.
- **Every 4 hours** — more aggressive; for high-volume mailboxes.
- **Off** — no notifications at all. Users have to actively check the quarantine portal if they want to see what's been blocked.

For SMB customers, daily is usually the right balance. More frequent notifications generate noise; off generates "I never got X" tickets because users don't think to check the portal.

## The BEC follow-on — why the defaults matter

The opening anecdote isn't hypothetical. It's the second-most-common follow-on vector after auto-forwarding (lesson 5). The attack sequence is consistent across incidents:

1. Attacker sends a phishing email crafted to look like a legitimate business communication (DocuSign, invoice, internal HR, IT password expiry).
2. The email lands in quarantine because Microsoft's anti-phishing classifier flags it — but with Phishing (not High-confidence) classification, because the message is technically well-formed and uses legitimate hosting infrastructure.
3. The user gets the quarantine notification, sees a plausibly-business-looking subject, doesn't want to delay something important, clicks Release.
4. The message arrives in the inbox. The user clicks the link. The credentials are captured. The session cookie is captured. The mailbox is compromised.

The defence is to remove the Release button for the dangerous categories. Configure all of Phishing, High-confidence phishing, Malware, and Spoof to AdminOnlyAccessPolicy. The notification can still come (so the user knows their email was quarantined and can ask the operator to investigate), but the Release button isn't there. The user has to call the help desk.

This adds operational load — operators now field "release my quarantined message" tickets. The trade-off is intentional: each release-request ticket is an opportunity to look at the message, verify it's legitimate, and either release it or use the conversation to educate the user about what they nearly clicked. The five-minute conversation is cheap; the wire fraud incident is expensive.

## The preset security policies make this easier

Microsoft's preset security policies (Standard and Strict — lesson 10 covers them in detail) include quarantine policy configurations. The Standard preset assigns the strict access policy (AdminOnlyAccessPolicy) to the High-confidence phishing, Malware, and Spoof categories by default. The Strict preset extends this to Phishing as well.

If you've applied the Standard or Strict preset to the customer (covered in lesson 3 and lesson 10), the quarantine configuration is partly handled. What the presets don't override is the cadence and the per-category policy mapping for Spam and Bulk — those are still tenant-specific decisions.

The takeaway: if you're deploying preset security policies and not customising quarantine further, you've already gotten the dangerous-categories release block. If you're configuring quarantine policies independently of presets, you have to make the AdminOnly assignment explicit for each dangerous category.

## The operator workflow — releasing on the user's behalf

When AdminOnlyAccessPolicy is in place and a user calls in to ask for a release:

1. **Open the quarantine portal** (Defender portal → Email & collaboration → Review → Quarantine). Search for the message by recipient, sender, or subject.
2. **Preview the message** before releasing. Read the body. Look at the links. Look at the sender details — including the actual sending address (not just the display name). Look at the headers if the message is borderline.
3. **Verify with the user** what they expected. "You said this is from Bob about the invoice — does this match what Bob would normally send? Is the link going where you expect?"
4. **Release if legitimate; report-as-phish if not.** Microsoft's Defender portal lets you release with an option to "submit to Microsoft for review" — this trains Microsoft's classifier and helps similar legitimate messages get through automatically in the future.

This is a 3-to-5 minute workflow per request. For customers with many releases, batch them — handle the queue once or twice a day rather than reacting to each call. For high-volume customers, consider tightening the anti-phishing or anti-spam tuning so fewer legitimate messages land in quarantine.

## What Panoptica365 sees

Quarantine policy configuration is part of what the **preset security policies** govern. The Panoptica365 security setting "Enable Preset Security Policy (Standard or Strict) — MDO" pushes the preset enablement at the customer tenant, and the drift detector watches whether it stays enabled. If a customer's admin opens the Defender portal and disables the preset — or creates a custom quarantine policy with permissive release rights that overrides the preset — the drift signal is the early warning.

**Defender XDR alerts** flow into Panoptica365's alert engine when MDO surfaces high-severity events related to user-initiated quarantine releases of suspicious messages. These show up in the standard alert pipeline.

What Panoptica365 does *not* surface in the dashboard: per-tenant quarantine queue browsers, per-message release-request approval workflow, per-user release-activity history. The quarantine queue itself, the per-message preview, the release approval action — all happen in the Microsoft Defender portal. Panoptica365 watches the *configuration* of the quarantine system; the *operation* of the quarantine queue is a Microsoft surface.

## What can break

**Customer complaints about messages "stuck in quarantine."** When AdminOnlyAccessPolicy is in place, users genuinely cannot release their own messages. They will phone in. Some customers experience this as a degradation. Frame it explicitly during the customer conversation as "we're protecting you from the AiTM-and-release attack pattern; the trade-off is that you call us to release ambiguous messages, and we take five minutes to verify." Most customers accept this once the trade-off is explained.

**Legitimate marketing or transactional email getting quarantined repeatedly.** Vendor invoices, DocuSign envelopes, calendar invitations from third parties — any system that sends mail with characteristics Microsoft scores as phishing-adjacent. The fix is either authenticating the sender properly (lesson 4) or adding the sender domain to the anti-phishing trusted-senders list (lesson 2). Not creating a permissive quarantine policy.

**Quarantine notifications going to junk.** Users sometimes set up rules that move all "noreply@" sender emails to junk, including Microsoft's quarantine digest. Then they complain they don't know about quarantined messages. Diagnose during onboarding and educate the user.

**Old custom quarantine policies left from previous admins.** Some customer tenants have custom quarantine policies inherited from migrations or previous MSPs. Audit them during pre-flight (lesson 1) and either align them with the Standard/Strict preset model or rebuild them explicitly.

## What this means for the operator

Three takeaways.

**Default quarantine release is a BEC follow-on vector.** Microsoft's defaults let users release lower-confidence phishing messages themselves. The assistant in the opening story is the recurring victim. Set AdminOnlyAccessPolicy on Phishing, High-confidence phishing, Malware, and Spoof — at minimum.

**Either deploy presets or configure quarantine policies explicitly.** The Standard or Strict preset handles the dangerous-category admin-only release configuration. If you're not using presets, every category needs an explicit policy assignment. There's no third option that's safe.

**Release-on-behalf is a five-minute operator workflow, and it's worth doing right.** When users call to release a message, that's the moment to verify the sender, preview the link, and either release with confidence or use the call to educate. The operational overhead is real but proportional to the protection — and the conversations themselves train customer users to be more skeptical of next time's phish.

## What's next

- **Lesson 8: Mail flow rules and MailTips.** Transport rules — the configuration object that gives operators surgical control over message handling, and the abuse pattern when used too broadly.
- **Lesson 9: Outbound spam and SMTP AUTH.** The post-compromise blast radius controls — what happens when a customer's mailbox is the one sending the phish.

For now: open the customer's quarantine policies in the Defender portal. Verify Phishing, High-confidence phishing, Malware, and Spoof are mapped to AdminOnlyAccessPolicy (or that the preset security policy is enabled and providing the same effect). Verify the notification cadence is daily, not turned off. The assistant in the opening story doesn't get her Release button this week; you can sleep better as a result.

---

*Sources for the data points in this lesson — Microsoft Learn on quarantine policies overview ([Microsoft Learn — Quarantine policies](https://learn.microsoft.com/en-us/defender-office-365/quarantine-policies)); creating and assigning custom quarantine policies ([Microsoft Learn — Manage quarantine policies](https://learn.microsoft.com/en-us/defender-office-365/quarantine-policies-configure)); user-quarantine release behaviour reference ([Microsoft Learn — Quarantine user permissions](https://learn.microsoft.com/en-us/defender-office-365/quarantine-end-user)); quarantine notification configuration ([Microsoft Learn — Quarantine notifications](https://learn.microsoft.com/en-us/defender-office-365/quarantine-policies#quarantine-notifications)); preset security policies and their quarantine effects ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)).*
