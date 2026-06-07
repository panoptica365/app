---
title: "Safe Links and Safe Attachments — what your customer paid for and isn't using"
subtitle: "Turning on Defender for Office 365 link wrapping and attachment sandboxing — and understanding what they catch and don't."
icon: "link"
last_updated: 2026-05-29
---

# Safe Links and Safe Attachments — what your customer paid for and isn't using

An accounting firm receives an invoice email from a supplier they actually work with. The supplier's domain authenticates correctly. The display name matches. The attached file is a PDF that opens to look like a normal invoice. The PDF contains a button: "View payment portal." The user clicks the button. The button is a hyperlink. The hyperlink goes to a credential-harvester that looks pixel-perfect like Microsoft's sign-in page, hosted on a freshly-registered domain with a brand-new Let's Encrypt certificate. The user types their M365 password. The attacker captures it, plus the session cookie via Evilginx2. Twenty minutes later the attacker is reading the user's email and adding an inbox rule to hide their tracks.

The customer has Microsoft 365 Business Premium. They've been paying for Defender for Office 365 Plan 1 for two years. Safe Links would have wrapped that PDF's hyperlink at delivery time. Safe Attachments would have detonated the PDF in a sandbox before it ever reached the user. Neither was configured. The features the customer paid for sat dormant while the attack chain ran end-to-end.

This lesson is about turning those features on, understanding what they catch, and being honest about what they don't.

## Safe Links — how the wrapping actually works

When Safe Links is enabled, every URL in an inbound email gets *rewritten* at delivery time. The original `https://realdomain.com/path` becomes something like `https://nam04.safelinks.protection.outlook.com/?url=https%3A%2F%2Frealdomain.com%2Fpath&...`. The user sees the original URL when they hover (most clients display the wrapped text but resolve to the original on hover); they see the original destination if they click and Microsoft passes the check.

At click time, three things happen:

1. **Microsoft's threat intelligence checks the destination URL** against Defender's reputation database. Known-malicious URLs are blocked at click time, even if the URL was clean at delivery.
2. **For unknown URLs, Microsoft may detonate them in real time** — fetching the destination from a sandbox, evaluating the page behaviour, and deciding whether to allow or block.
3. **The user is allowed through, blocked with a warning page, or shown a "be careful" interstitial** depending on the verdict.

This is the value over a static blocklist. A phishing link that was clean at 9:00 AM (when the email was delivered) and turned malicious at 3:00 PM (when threat intel picked it up) gets caught at the 4:00 PM click. The same domain blocked across one customer tenant is blocked across every Defender-protected tenant, in seconds.

**Settings worth knowing:**

- **"Track user clicks"** — telemetry on who clicked what. On. The data shows up in MDO threat reports.
- **"Do not rewrite the following URLs"** — exclusion list for legitimate URLs that break when wrapped. Use sparingly; this is the Safe Links equivalent of the trusted-senders list (and the same discipline applies — don't bypass without a reason).
- **"Let users click through to the original URL"** — when Safe Links blocks something, this setting controls whether users can override. For hardening, this should be **off**. Letting users click through means they will, and the wrapper becomes decorative.
- **"Display the organization branding"** — cosmetic; lets you put the customer's logo on the warning page. Worth doing for the conversation it starts when a user sees it.

## Safe Attachments — the detonation sandbox

When Safe Attachments is enabled, inbound emails with attachments get held in a Microsoft sandbox. The attachment is opened, its behaviour observed (process spawning, network calls, registry writes, macro execution, all of it), and a verdict produced. Common scan times are under a minute; complex files can take longer.

The verdict drives one of four actions, chosen per-policy:

- **Block** — malicious attachments stop delivery entirely; the email arrives without the attachment, or doesn't arrive at all (configurable).
- **Replace** — the attachment is removed, the email body still arrives, with a notification explaining what happened.
- **Dynamic Delivery** — the email arrives immediately with a placeholder, the real attachment is added once the sandbox completes. The user can read the email body while the scan runs. Best balance of security and user experience for SMB.
- **Monitor** — audit-only; the attachment is delivered unchanged, but malicious verdicts are logged. Useful for testing; not a production posture.

For most SMB tenants, **Dynamic Delivery** is the right action. Users get the email body immediately (no "where's my email?" tickets), the attachment shows up a minute later, and malicious attachments never arrive at all.

**Safe Documents** is a related feature in Microsoft 365 Apps for enterprise (E5-level licensing) that opens documents from external sources in Protected View and scans them via Microsoft Defender for Endpoint before letting users edit. Worth knowing about; not in Business Premium.

## SafeLinks-for-Office — links inside docs and Teams

Safe Links was originally email-only. But attackers figured out you could deliver a clean email with a clean Word document, and put the malicious link *inside* the Word document. The link never got wrapped because Safe Links didn't touch the document. The user opens Word, clicks the link, gets phished. End run around Safe Links.

Microsoft fixed this. **SafeLinks-for-Office** extends URL evaluation into:

- Word, Excel, PowerPoint, OneNote (desktop and web)
- Microsoft Teams chats, channels, and posts
- Visio (desktop and web)

When a user clicks a link inside any of those, the URL gets checked against Microsoft's threat intelligence in the same way an email-delivered link would. This closes the most-common evasion path.

**Setting:** "Protect Office 365 apps" — should be **on** in the Safe Links policy. It's part of the Standard preset; with custom policies, you have to remember to enable it.

## What they catch, what they miss — be honest

Safe Links and Safe Attachments are layered defences, not silver bullets. The opening anecdote is real because both features have real limits.

**Safe Links catches:**

- URLs to known-malicious destinations
- URLs to destinations that turn malicious between delivery and click
- URLs to brand-new domains with characteristics Microsoft's ML recognises (registration age, hosting reputation, content fingerprint)
- URLs that evade pre-click static analysis but fail dynamic detonation

**Safe Links misses:**

- Brand-new phishing domains with valid TLS, no threat-intel coverage yet, and Microsoft-perfect login UI. The opening anecdote's credential-harvester is exactly this case. Safe Links checks; threat intel hasn't categorised the domain yet; the page renders fine in the sandbox; the URL passes. The user lands on the phish.
- Legitimate-but-compromised business sites. A legitimate WordPress site gets hijacked, attacker hosts the credential-harvester on the legitimate domain for six hours, Safe Links sees a domain with good reputation and passes the URL.
- URLs delivered out-of-band (SMS, WhatsApp, the user typing in a URL they remember from a phone call). Safe Links only protects what flows through M365's email or document surfaces.

**Safe Attachments catches:**

- Malware with recognisable behaviour patterns in a sandbox
- Documents with malicious macros that execute on open
- Files with known-malicious hashes
- Files that match Microsoft's ML detection signatures for novel malware

**Safe Attachments misses:**

- Password-protected archives. Microsoft can't open `.zip` files with passwords; the sandbox can't detonate what it can't unwrap. Attackers know this and use it constantly. The password is helpfully provided in the email body: "Password: 12345."
- Files that detect the sandbox environment and behave benignly inside. Some malware checks for virtualisation indicators, mouse movement, or specific Office processes before activating.
- Living-off-the-land payloads. The attachment itself isn't malicious; it triggers a workflow that uses legitimate Windows binaries (mshta.exe, certutil.exe, PowerShell) to do harm. The sandbox sees nothing wrong with the document.
- Cloud-based payloads. The document doesn't contain malware; it contains a link to a cloud-hosted payload that loads at execution time. Safe Attachments sees a clean document; Safe Links may or may not catch the cloud link depending on reputation.

**The takeaway:** these features are *necessary but not sufficient*. They catch the bulk of mass-market phishing and malware. They don't catch a determined attacker building a custom AiTM workflow against your customer. That's why the rest of the curriculum exists — Conditional Access, phishing-resistant MFA, anti-phishing impersonation protection, user training. Layered defence. Safe Links and Safe Attachments are two of the layers.

## Configuration — the practical bit

By default, neither feature has a policy assigned to anyone. You have to create the policies and assign them to user groups.

**For most SMB customers, the right starting configuration:**

- Apply the **Standard preset security policy** to all users. This creates Safe Links and Safe Attachments policies with Microsoft's curated defaults, assigns them to all users in the tenant, and turns on SafeLinks-for-Office. Done in three clicks.
- If the customer has higher-risk profile (finance, legal, healthcare, government contracting), apply **Strict** instead.

**For customers needing custom configuration:**

- Create a custom Safe Links policy with the settings above (track clicks on, no user override, Office apps protection on, no rewrite exclusions unless needed).
- Create a custom Safe Attachments policy with **Dynamic Delivery** as the action.
- Assign both to all users (or to the right scope; lesson 10 covers preset-and-overlay scoping).

The preset approach is right for most. The custom approach is for customers with specific exclusions to manage or specific actions to tune.

## What can break

**The "Safe Links is blocking our vendor portal" ticket.** A legitimate vendor's portal URL gets wrapped, the wrapped URL doesn't render correctly because the vendor's site uses session tokens that don't survive the wrap, the user can't get in. The fix is adding the vendor's domain to the "do not rewrite" list — *not* turning off Safe Links for the user. (Same discipline as trusted-senders in lesson 2.)

**Attachment delivery delay complaints.** Without Dynamic Delivery, users wait up to a minute for the attachment to scan before the email arrives. Frustrating for executives expecting an attachment to be there *now*. Dynamic Delivery solves this — email body arrives immediately, attachment fills in. If Dynamic Delivery isn't enabled, expect tickets in the first week.

**Macro-heavy legitimate documents getting flagged.** A legitimate Excel macro that does something unusual (a complex automation workflow, a reporting tool with macros) can trigger Safe Attachments. The fix is either an attachment-level allow (rare; specific file hash) or a sender-level allow (more common; trusted partner). Same discipline as anti-phishing trusted-senders applies — check if there's a reason the file is being flagged before adding the exception.

## Rollout

For Safe Links specifically, deploy via the **Standard or Strict preset** for the entire user base from day 0. The blocking action only fires on actually-malicious URLs, so collateral damage is rare. The most common breakage is the "vendor portal" case above, which surfaces as tickets in the first week and gets resolved with targeted exclusions.

For Safe Attachments, the same applies — preset deployment, Dynamic Delivery action so users don't notice the scan delay, exclusions for known macro-heavy legitimate workflows added as they surface.

The Audit-mode rollout pattern (lesson 1 of card 4) does not really apply here — these features are too low-impact to warrant a 30-day audit window. Direct deployment is the norm.

## What Panoptica365 sees

Two things relevant to this lesson:

- **Drift on the preset security policy enablement.** If a customer's tenant has Safe Links and Safe Attachments deployed via the Standard or Strict preset (the recommended path), Panoptica365 watches whether the preset stays enabled. Somebody turning off the preset — by mistake or in response to a customer complaint — fires a drift alert. The operator can revert, reapply, or accept.
- **Defender for Office 365 detection events flow through Defender XDR.** When Safe Links blocks a URL at click time or Safe Attachments quarantines a malicious file, the underlying detection event is part of Microsoft's MDO telemetry. When Defender XDR ingestion is configured for the customer (card 1 lesson 4), high-severity MDO incidents flow into Panoptica365's alert engine.

What Panoptica365 does not surface today: per-user click rates through Safe Links, per-attachment scan results, the Defender portal's threat tracker views. Those are Microsoft Defender portal surfaces; drill in there for the deep diagnostic.

## What this means for the operator

Three takeaways.

**These are the features customers paid for and aren't using.** Most SMB customers with Business Premium have Safe Links and Safe Attachments licensed. Most have them unconfigured. The single highest-leverage move for an MSP onboarding a new customer is enabling the Standard preset — three clicks, immediate value, no per-user setup.

**Be honest about the limits.** Safe Links and Safe Attachments catch the mass-market phishing and malware that hits SMB tenants daily. They don't catch a determined custom AiTM operation, a password-protected archive, or a sandbox-evading payload. Tell customers that. The layered-defence story (Safe Links + impersonation protection + Conditional Access + phishing-resistant MFA + user training) is the right pitch — not "we turned on Safe Links and you're now bulletproof."

**Dynamic Delivery is the right Safe Attachments action.** Blocking attachment delivery while the sandbox scans is the difference between users tolerating Safe Attachments and users hating it. Set the action to Dynamic Delivery; email body arrives instantly; attachment fills in; nobody notices the security work.

## What's next

- **Lesson 4: SPF, DKIM, DMARC.** The authentication trio that closes the spoofing-side gap. The other half of what anti-phishing and Safe Links don't catch.
- **Lesson 5: Auto-forwarding and inbox rules.** The post-compromise indicator pair — what happens after an attacker is already inside, and how to spot them.

For now: open the customer's Defender portal. Look at the preset security policies surface. If the Standard or Strict preset isn't enabled, you've found the highest-impact change you can make this week. Three clicks. The features the customer is already paying for finally start doing their job.

---

*Sources for the data points in this lesson — Microsoft Learn on Safe Links overview ([Microsoft Learn — Safe Links in Defender for Office 365](https://learn.microsoft.com/en-us/defender-office-365/safe-links-about)); Safe Links policy configuration ([Microsoft Learn — Set up Safe Links policies](https://learn.microsoft.com/en-us/defender-office-365/safe-links-policies-configure)); Safe Attachments overview and policy settings ([Microsoft Learn — Safe Attachments](https://learn.microsoft.com/en-us/defender-office-365/safe-attachments-about)); Dynamic Delivery action explained ([Microsoft Learn — Dynamic Delivery in Safe Attachments](https://learn.microsoft.com/en-us/defender-office-365/safe-attachments-policies-configure)); SafeLinks-for-Office and Teams coverage ([Microsoft Learn — Safe Links for Microsoft Teams](https://learn.microsoft.com/en-us/defender-office-365/safe-links-about#safe-links-settings-for-email-messages)); preset security policies bundle ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)).*
