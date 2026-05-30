---
title: "Anti-phishing policies — the impersonation gap Microsoft leaves on by default"
subtitle: "User impersonation protection, anti-spoofing tuning, and the BEC patterns Microsoft's defaults don't catch."
icon: "fish"
last_updated: 2026-05-29
---

# Anti-phishing policies — the impersonation gap Microsoft leaves on by default

A controller at a 40-person manufacturing company gets an email from her CEO on a Tuesday afternoon. Subject: "Confidential — payment needed today." Body: "Please pay the attached invoice from our new equipment supplier. Wire details inside. Don't loop in accounting yet — I'll explain Thursday." Signed with the CEO's actual sign-off block, formatted exactly the way her real emails look.

The controller reads the email on her phone. The display name says "James Wilson, CEO" — same as every other email from the CEO. She taps the attachment, sees what looks like a legitimate invoice with bank details, and starts the wire. $46,000.

The actual sending address — visible only if you tap the display name and squint — was `james.wilson.ceo@gmail.com`. Not the customer's domain. Not even close. But on a phone, in the inbox view, you see the display name. The display name said the right thing.

This is the most common BEC pattern in 2026 and the one Microsoft's default anti-phishing policy doesn't catch. Anti-spoofing on the customer's actual domain works fine — the attacker isn't spoofing the customer's domain, they're using Gmail. The defence that *would* have caught this is **user impersonation protection**, and Microsoft ships it turned off.

This lesson is about closing that gap.

## The four layers of M365 anti-phishing — and which ones are on

Microsoft 365's anti-phishing protection is four distinct mechanisms living under the same policy umbrella. Most operators treat them as one feature. They're not. Knowing which is which is the whole game.

**Anti-spoofing.** Catches mail that *claims to be from the customer's own domain* but failed SPF / DKIM / DMARC authentication. Default: **on**. This is the basic floor — if someone sends a forged message claiming to be `ceo@customer.com` from a server that has no business sending for `customer.com`, anti-spoofing catches it. Microsoft's defaults are reasonable here.

**Mailbox intelligence.** Uses Microsoft's ML on the recipient's communication history. If a user has never received mail from a particular sender, but the sender's identity looks like someone they DO regularly communicate with, mailbox intelligence flags it. Default: **on with first contact safety tip**, but the *enforcement actions* (move to junk, quarantine) are typically configured at the **Off** position until you tune the policy.

**User impersonation protection.** You specify "protected users" — typically the CEO, CFO, controller, anyone who could plausibly be asked to wire money. The policy then flags mail from senders whose display name closely matches one of those protected users *but whose sending address doesn't*. Default: **off**. This is the gap in the opening story.

**Domain impersonation protection.** You specify "protected domains" — typically the customer's own domain(s) and any partner / supplier domains the customer routinely transacts with. The policy flags lookalike domains (`trilogiam.com` vs `trilogiam-corp.com`, `customer.com` vs `customer.co`, the classic homoglyph attacks where a Cyrillic 'a' replaces a Latin 'a'). Default: **off**.

Two of four. On by default: the two that catch the easy attacks. Off by default: the two that catch the attacks SMB customers actually fall for.

## The trusted-senders pattern — what customers actually ask for

You will get this ticket. Probably this week:

> "Stop your anti-phishing thing from blocking emails from our partner ABC Corp. We need their invoices to come through."

**Before you touch a single setting, check the sender's email authentication.** It takes two to dance when it comes to email — and most of the time, the dance partner has missing steps.

Pull up a DNS lookup tool. The one we recommend for this kind of work is [DomainGuardian](https://domainguardian.nebiatek.com/) — a clean, visual checker built by a colleague in the Quebec cybersecurity community. Paste a domain in, get a colour-coded breakdown of SPF, DKIM, DMARC, MX, and related records with clear flags on what's right and what's broken. Designed for L1 techs who shouldn't have to memorise `dig` syntax to do their job. (Command-line operators can still reach for `dig` or `nslookup` if that's faster for them.)

Check `abccorp.com` for:

- **SPF.** Is there a TXT record starting with `v=spf1`? Does it include the IPs or services ABC Corp actually sends from? Common failure: SPF exists but ends in `~all` (soft-fail) or `+all` (allow everything — basically broken).
- **DKIM.** Is there a DKIM selector record published? Try common selectors (`default._domainkey`, `selector1._domainkey`, `s1._domainkey`, plus the specific selectors for Microsoft 365, Google Workspace, Mailchimp, or whatever they actually send through).
- **DMARC.** Is there a TXT record at `_dmarc.abccorp.com`? What's the policy — `p=none`, `p=quarantine`, `p=reject`? Is `aspf` and `adkim` set?

In a large fraction of these tickets — comfortably the majority of SMB-to-SMB email — the sender has SPF set up (often half-configured), no DKIM at all, and no DMARC. From Microsoft's perspective, the email looks exactly like the kind of mail an attacker would send: poorly authenticated, sometimes failing alignment, with no policy from the sender's domain telling receivers what to do with it. The quarantine isn't a bug — it's Microsoft doing exactly what you want it to do.

The first move is the conversation, not the exception:

> "ABC Corp's email authentication is misconfigured — specifically, they have no DKIM and no DMARC published. That's why their emails are getting flagged. The fix is at *their* end: their IT team needs to publish DKIM signing and a DMARC record. Once they do that, Microsoft will trust their email and we won't need an exception at all. Can you reach out to your contact at ABC Corp and ask them to have their IT look at this?"

Half the time this conversation resolves the issue cleanly within a week — ABC Corp's IT publishes DKIM and DMARC, Microsoft starts trusting the mail, the customer never asks you about it again, and the broader email ecosystem gets one notch healthier. The other half of the time ABC Corp can't or won't fix their authentication (small vendor with no IT, vendor's MSP shrugs, the customer's "contact" doesn't have the political capital to push), the customer reports back, and *then* you fall back to one of two exception patterns: one right, one tempting.

**The tempting way.** Open the Exchange admin centre. Create a mail flow rule that bypasses spam filtering for all mail from `*@abccorp.com`. The customer's ticket closes. Tomorrow, ABC Corp's domain gets compromised by a phishing attack and the attackers send malware-laden invoices to the customer's controller. The mail flow rule you created cheerfully bypasses every defence Microsoft would otherwise apply. The controller opens the attachment. You spend the weekend on incident response.

**The right way.** Open the anti-phishing policy. Add `abccorp.com` to the trusted senders list at the *anti-phishing policy level*, scoped to *that specific protection* (typically user impersonation and mailbox intelligence). The trusted-senders entry tells the anti-phishing policy "messages from this domain shouldn't trigger impersonation flags." Spam filtering, malware scanning, Safe Links, Safe Attachments — all of those still apply. If ABC Corp's domain is compromised tomorrow, the malware in their invoices gets caught by Safe Attachments before it reaches the controller's inbox.

The difference between the two approaches is the blast radius when the trusted sender is later compromised. Customers don't think about that part. You have to.

## Configuring user impersonation protection — the practical bit

For a typical SMB customer, the configuration is straightforward and the discipline is in knowing *who* to protect.

**Who to protect.** Anyone in a position where impersonating them would lead a recipient to send money, share credentials, or grant access. Real list:

- The CEO, CFO, and any C-level
- The controller, head of finance, head of accounting
- The head of HR (W-2 / payroll scams)
- The head of IT (credential and access requests)
- The owner / founder / principal (small companies)

A 40-person company might have 5 to 8 protected users. A 200-person company might have 12 to 20. Don't try to protect everyone — the policy gets noisy and the operator team loses signal.

For each protected user, the policy needs:

- The user's display name (exactly as it appears in Entra ID)
- The user's email address (typically `firstname.lastname@customer.com`)

The policy flags any inbound message whose sender display name closely matches a protected display name OR whose sender address closely matches a protected address — but the sender isn't actually that user. The opening anecdote (`james.wilson.ceo@gmail.com` with display name "James Wilson, CEO") gets caught because the display name matches a protected user but the address doesn't.

**What to do when flagged.** Three options: move to junk, quarantine, or "deliver and add safety tip." For SMB customers, **quarantine** is typically the right choice. The safety-tip option assumes users read safety tips; many don't. Junk lets the user release the message themselves; for high-confidence impersonation flags, you don't want the user making that judgment call. Quarantine routes through the operator workflow.

## Configuring domain impersonation protection

Same idea, scoped to domains.

**Domains to protect:**

- The customer's primary email domain (always)
- Any other email domains the customer actively uses
- Key partner/supplier/vendor domains the customer transacts with (top 10–20 by transaction volume)

The policy flags inbound mail from domains that are visually similar to one of the protected domains. The classic case: customer is `acme.com`, attacker registers `acne.com` or `acrne.com` (where the 'r' and 'n' together look like an 'm' on a phone screen) or `аcme.com` (with a Cyrillic 'а'). All three get caught.

The flagged-action choice (move to junk, quarantine, safety tip) follows the same logic as user impersonation. Quarantine is typically right for SMB.

## Spoof intelligence — the manageable tail

Microsoft's spoof intelligence is the inverse of impersonation protection. Where impersonation catches *illegitimate* senders trying to look like *legitimate* ones, spoof intelligence handles the *legitimate* senders who fail authentication for boring infrastructure reasons.

The most common case: the customer uses a third-party service (a marketing platform, an HR-tool email sender, a survey provider) that sends "from" the customer's domain but doesn't have proper SPF / DKIM authorisation. Microsoft's anti-spoofing wants to block this; spoof intelligence lets you review the senders, allow the legitimate ones, and block the ones that are actually attackers.

This is the "Tenant Allow/Block Lists" surface in the Defender portal. The operator's discipline:

- Review the spoof intelligence insights monthly
- For each unauthenticated-but-legitimate sender (marketing platform, payroll vendor, etc.), add an explicit allow entry
- For each unauthenticated-and-illegitimate sender, add an explicit block
- Tell the customer's marketing team to fix their SPF / DKIM configuration so you don't have to keep adding allows

## The preset security policy alternative

For customers where you don't want to hand-tune the anti-phishing policy, Microsoft's **preset security policies** (Standard and Strict, covered in detail in lesson 10) include preconfigured anti-phishing rules. The Standard preset enables user impersonation protection with sensible defaults; the Strict preset turns the knobs higher.

The preset approach trade-off: you get Microsoft's curated configuration, you lose granular control over thresholds and trusted-senders lists. For most SMB customers, this is the right trade. For customers with specific impersonation needs (lots of protected users, complex trusted-sender exceptions), a custom policy gives you the flexibility.

In practice: deploy a preset (Standard for most; Strict for higher-risk customers like accounting firms or law firms) as the *foundation*, then layer a custom anti-phishing policy *with higher priority* for the customer-specific protected users and trusted-senders. This pattern keeps the Microsoft-curated defaults as the floor while letting you customise where it matters.

## What can break

**Customer's executive's emails to themselves get quarantined.** When the CEO emails their own assistant from their personal Gmail address and the display name matches the protected-user list, impersonation protection catches it. The fix is either to add the executive's personal address to the trusted-senders list or to have the executive use their work account for work email (the correct answer).

**Legitimate vendors with poor email hygiene get blocked.** A small vendor with no DMARC, mismatched SPF, and a habit of sending from random IP addresses will trip several anti-phishing checks. Adding them to trusted senders solves it; ideally the vendor fixes their authentication, but that's a slow conversation.

**Marketing platforms sending under the customer's domain.** If the customer's marketing team uses HubSpot, Mailchimp, Marketo, or similar to send under the customer's domain without proper SPF / DKIM authorisation, those emails fail anti-spoofing and get caught by impersonation when the display name matches a protected user. The fix is either authentication setup at the marketing platform (right answer) or trusted-senders entries (workaround).

## What Panoptica365 sees

Anti-phishing policy state is one of the security settings Panoptica365 monitors per tenant. Specifically:

- **Drift on the preset security policy enablement.** If Microsoft's preset security policy (Standard or Strict) gets disabled at a customer tenant — somebody opens the Defender portal and turns it off, either by mistake or in response to a complaint — the drift detector fires an alert. The operator can revert, reapply, or accept.
- **Alert engine evaluators on phishing-related events.** When Defender XDR detects a phishing-pattern incident at a customer tenant, the alert flows into Panoptica365's alert engine, where it appears alongside other security alerts with attribution back to the customer.

What Panoptica365 does not surface today: per-user impersonation flagging volume, per-policy thresholds, the spoof intelligence insights list, or any per-mailbox phishing posture. Those live in the Microsoft 365 Defender portal — drill in there when you need the deep diagnostic view.

## What this means for the operator

Three takeaways.

**The impersonation gap is the BEC gap.** Microsoft's default anti-spoofing catches the easy attacks; impersonation protection catches the ones SMB customers actually fall for. If you do one thing for the customer this quarter, turn user and domain impersonation on with quarantine action and a thoughtful protected-users list.

**When a customer asks you to "let X through," check X's authentication first.** It takes two to dance — and most quarantine complaints trace back to the sender's missing DKIM and DMARC, not to over-aggressive filtering on the receiving side. Push the conversation to the sender first. When an exception is still needed after that, route it through the anti-phishing policy's trusted-senders list, scoped to the specific protection — never a mail flow rule bypass. Spam filtering, Safe Links, Safe Attachments stay in force.

**The preset policy is a defensible default; customisation is where the value sits.** Deploy a preset (Standard or Strict) as the floor; layer a custom anti-phishing policy with the customer-specific protected users and trusted senders. This gives you Microsoft's curated tuning plus the customer-specific defence you need.

## What's next

- **Lesson 3: Safe Links and Safe Attachments.** The Defender for Office 365 P1 features the customer paid for and isn't using. Where they catch real attacks and where they fall short.
- **Lesson 4: SPF, DKIM, DMARC.** The authentication trio that closes the spoofing side of the gap — the half anti-phishing doesn't catch.

For now: open the customer's anti-phishing policy. Turn user impersonation on. List the protected users. Turn domain impersonation on. List the protected domains. Set the action to quarantine. Layer a custom trusted-senders list for the legitimate partners. This single configuration change closes the most common SMB BEC vector — the one the controller in the opening story fell for.

---

*Sources for the data points in this lesson — Microsoft Learn on anti-phishing policy configuration ([Microsoft Learn — Anti-phishing policies in EOP and MDO](https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-policies-about)); user impersonation protection ([Microsoft Learn — Impersonation protection in anti-phishing](https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-policies-mdo-configure)); spoof intelligence and the Tenant Allow/Block Lists ([Microsoft Learn — Spoof intelligence insight](https://learn.microsoft.com/en-us/defender-office-365/anti-spoofing-spoof-intelligence)); mailbox intelligence ([Microsoft Learn — Mailbox intelligence](https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-mdo-impersonation-insight)); preset security policies ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)).*
