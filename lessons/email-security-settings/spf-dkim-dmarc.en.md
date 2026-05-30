---
title: "SPF, DKIM, DMARC — the email authentication trio almost everyone gets wrong"
subtitle: "How SPF, DKIM, and DMARC work together to stop domain spoofing — and why p=none is the same as no policy at all."
icon: "shield-check"
last_updated: 2026-05-29
---

# SPF, DKIM, DMARC — the email authentication trio almost everyone gets wrong

An MSP gets a panicked call from a customer on a Thursday afternoon. "Our biggest client just called. They got an email this morning that looked like it was from our CFO — wire instructions, urgent supplier payment, the works. They almost paid it. The email headers say it came from our domain. How did the attacker get into our system?"

The answer is the worst kind of answer: the attacker didn't get into anything. They're outside, sending forged email from their own infrastructure, putting the customer's domain in the `From` header. The customer's email is fine. The customer's CFO is fine. The customer's CRM and Active Directory and bank account are fine.

The customer's partner *also* sees a forged email and almost wires money to the attacker. The customer takes the reputational hit. The partner takes the financial hit. The MSP takes the awkward conversation.

This is the attack that SPF, DKIM, and DMARC exist to stop. The customer has SPF. They might have DKIM. They probably don't have DMARC. Even if they have all three, DMARC is almost certainly set to `p=none`, which is observe-only — it does nothing to block the spoof. The receiving mail server (the partner's mail provider) sees the failed authentication, has no policy from the customer's domain telling it what to do, and makes a judgement call. Often the wrong one.

This lesson is about closing that gap honestly. The journey from "no DMARC" or `p=none` to `p=reject` is the most consequential email-hardening work an MSP does — and the most commonly skipped.

## The three mechanisms, distinct and complementary

SPF, DKIM, and DMARC are *three separate things* that work together. Operators conflate them constantly. Knowing which is which is the foundation.

**SPF (Sender Policy Framework).** A DNS TXT record on your domain that lists the IP addresses and services authorised to send mail "from" your domain. Published as `v=spf1 include:spf.protection.outlook.com -all` for an M365-only tenant. The receiving server, when an email arrives claiming to be from your domain, checks the sending IP against your published SPF record. If the IP isn't authorised, SPF fails.

**DKIM (DomainKeys Identified Mail).** A cryptographic signature added to outgoing email by the sending server, using a private key. The corresponding public key is published in DNS as a TXT record at a selector subdomain (e.g., `selector1._domainkey.customer.com`). The receiving server retrieves the public key, verifies the signature against the message body. If the signature is valid, the email proves it was sent by an authorised system *and* hasn't been tampered with in transit.

**DMARC (Domain-based Message Authentication, Reporting, and Conformance).** A DNS TXT record at `_dmarc.customer.com` that tells receiving servers what to do when SPF or DKIM fail. Three policies: `p=none` (do nothing — just send me a report), `p=quarantine` (treat as suspicious — junk folder), `p=reject` (refuse the message outright — bounce). Plus a report destination — an email address that gets daily aggregate reports of every server attempting to send under your domain.

Three layered things:
- SPF asks "is the sending IP allowed to send for this domain?"
- DKIM asks "is the message cryptographically signed by the authorised domain?"
- DMARC asks "if SPF or DKIM fail, what should the receiver do, and where should I report it?"

A domain with only SPF is half-protected. A domain with only DKIM is half-protected. A domain with both but no DMARC is *observably authenticated* but the receiver still has to decide what to do with failed messages — and many will let them through.

## Alignment — the concept most operators miss

SPF and DKIM both "pass" or "fail," but DMARC adds a crucial extra check: **alignment**.

**SPF alignment** means the domain in the SPF check matches the domain in the visible `From:` header that the user sees. Attackers can authenticate from their own domain (`evil-attacker.com`) and put your domain in the visible `From:`. SPF passes — for the attacker's domain. The visible `From:` says yours. SPF alignment catches this mismatch.

**DKIM alignment** means the domain signing the message via DKIM matches the visible `From:` domain. Same logic — an attacker can DKIM-sign with their own domain while forging the visible `From:`. DKIM alignment catches the mismatch.

DMARC requires *at least one of SPF or DKIM to pass with alignment*. Both passing-but-unaligned is still a DMARC failure. The receiver then applies your DMARC policy (`p=quarantine` or `p=reject`).

This is the part that operators miss. A domain can have a valid SPF record AND valid DKIM AND still be spoofable because nothing enforces alignment. DMARC enforces it.

## The journey — p=none to p=quarantine to p=reject

Almost every SMB customer's DMARC journey looks like this:

**Stage 0 — No DMARC at all.** Most domains. The receiver gets failed SPF/DKIM and decides on its own (usually it lets the mail through because rejecting feels rude). The customer is fully spoofable.

**Stage 1 — DMARC published at p=none.** The customer has *observability* — daily aggregate reports tell you who's sending under your domain, from where, with what authentication status. But the policy still says "do nothing," so spoofing still works. This is where 80% of domains with DMARC live, often for years.

**Stage 2 — DMARC at p=quarantine.** Failed-authentication mail goes to the recipient's junk folder. Most attackers' spoofed mail doesn't reach the inbox. Some users still find it in junk and act on it; that's a smaller blast radius but not zero.

**Stage 3 — DMARC at p=reject.** Failed-authentication mail is refused entirely by the receiving server. The recipient never sees it; the sender (real or attacker) gets a bounce. The customer's domain is no longer spoofable from the receiver's perspective.

The journey from Stage 0 to Stage 3 takes weeks to months for most customers. Not because it's technically hard — the DNS changes are small. Because between `p=none` and `p=reject`, you have to find every legitimate sender that's authenticating poorly and fix them, or accept that they'll be quarantined/rejected.

This is the part that scares MSPs into staying at `p=none` indefinitely. Don't be that MSP. The customer is one social-engineering email away from a wire fraud incident that DMARC would have stopped.

## Diagnosis — using DomainGuardian

Before touching anything, audit the current state. [DomainGuardian](https://domainguardian.nebiatek.com/) gives you the colour-coded view for SPF / DKIM / DMARC / MX / related records, designed for L1 techs who don't want to memorise DNS lookup syntax.

For each accepted domain on the customer's tenant, check:

- **SPF.** Does it exist? Does it end in `-all` (hard fail) or `~all` (soft fail) or `+all` (catastrophic — allow everything)? Does it include `spf.protection.outlook.com` (required for M365)? Does it include any other senders the customer actually uses (marketing platforms, payroll vendors, accounting tools)? Is the lookup count under 10 (SPF's hard limit — exceed it and the record breaks)?

- **DKIM.** Is DKIM enabled for this domain in the M365 admin centre? Are the corresponding CNAME records (`selector1._domainkey.customer.com` and `selector2._domainkey.customer.com`) published in DNS pointing to Microsoft's targets? Are they actually resolving correctly?

- **DMARC.** Does a TXT record exist at `_dmarc.customer.com`? What's the policy (`p=none`, `p=quarantine`, `p=reject`)? Is there an aggregate report destination (`rua=mailto:...`)? Are `aspf` and `adkim` set (alignment modes — `r` for relaxed, `s` for strict)?

Document the findings per domain. The audit is the foundation for the journey.

## Configuration — the practical steps

**SPF, for an M365-only tenant:**

```
v=spf1 include:spf.protection.outlook.com -all
```

Add other includes for third-party senders the customer uses (Mailchimp's `include:servers.mcsv.net`, SendGrid's `include:sendgrid.net`, ADP's `include:spf.adp.com`, etc. — each platform documents their include). Keep the total includes under 10 to stay within the lookup limit. End with `-all` (hard fail) for production hardening — `~all` is a stepping-stone, not a destination.

**DKIM, in M365:**

Open the Microsoft 365 Defender portal → Email & collaboration → Policies & rules → Threat policies → Email authentication settings → DKIM. Select each accepted domain. Microsoft displays the two CNAME values you need to publish in DNS. Publish them. Wait for DNS propagation (usually under an hour). Toggle DKIM signing to *enabled* in the portal for the domain.

This needs to be done **per accepted domain**. The customer's `onmicrosoft.com` domain has automatic DKIM; their custom domains do not until you configure each one.

**DMARC, starting at p=none:**

```
v=DMARC1; p=none; rua=mailto:dmarc-reports@customer.com; aspf=r; adkim=r;
```

Published as a TXT record at `_dmarc.customer.com`. The `rua` destination should be a mailbox you (or a DMARC reporting service) actively monitor — the reports come daily and they're the gold mine for the next stage.

**Reading the reports** is the hard part of the journey. The reports are XML files (one per sending server, per day). For SMB customers, you want a service that turns the XML into readable dashboards showing who's sending under your domain, what authentication status they have, and which senders you need to fix. The one we recommend is [mailsec.ca](https://mailsec.ca/). Other options exist (Postmark's DMARC monitoring, Valimail, dmarcian, Mailhardener); pick one per MSP and use it consistently across customers so the workflow becomes familiar.

**Advancing to p=quarantine:**

Once you've spent a few weeks at `p=none` and have identified (and fixed) all the legitimate senders, change the policy:

```
v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@customer.com; aspf=r; adkim=r; pct=25;
```

The `pct=25` rolls out quarantine to 25% of failed-authentication mail. Watch the reports for two weeks. If nothing legitimate breaks, raise to `pct=50`, then `pct=100`. This is the safety net for surprises.

**Advancing to p=reject:**

Once `p=quarantine; pct=100` has run cleanly for a few weeks, flip to `p=reject`. The customer's domain is now non-spoofable from the receiver's perspective.

## What can break

**Legitimate senders without proper SPF/DKIM authorisation.** Marketing platforms, payroll vendors, CRM systems, survey tools — any service sending under the customer's domain that doesn't have proper SPF includes or DKIM signing. Once DMARC tightens to `p=quarantine` or `p=reject`, those senders get quarantined or bounced. The fix is service-specific — add SPF includes, configure DKIM for the third-party sender, or migrate the sender to a subdomain with its own DMARC policy.

**Marketing campaigns where the customer didn't tell IT.** A common cycle: marketing tries a new email platform, sends a campaign, half the recipients never get it because DMARC blocked the unauthenticated mail. Marketing complains to IT. IT realises marketing has been using the platform for months. The fix is to authenticate properly, not to weaken DMARC.

**Forwarded mail.** Mail forwarded through an intermediary (a mailing list, a personal forwarder) often fails DMARC because the forwarding server's IP doesn't match SPF and the message body gets modified, breaking DKIM. Modern mailing lists handle this via ARC (Authenticated Received Chain) but older infrastructure still trips DMARC.

**SPF lookup limit exceeded.** SPF records that nest too many includes (10-lookup hard limit) become invalid. M365 alone uses one include; add Mailchimp, ADP, and Salesforce and you can hit the limit fast. SPF flattening tools (paid services) collapse the includes into raw IP lists to stay under the limit.

## What Panoptica365 sees

SPF, DKIM, and DMARC are DNS records on the customer's domain — outside Panoptica365's M365-tenant-focused read model. Panoptica365 does not currently audit DNS records natively; the operator's workflow is using DomainGuardian (or a similar tool) for the periodic audit.

What Panoptica365 *does* surface that's relevant:

- **DKIM enablement state in the M365 tenant.** Toggling DKIM "enabled" per domain is an M365 setting — Panoptica365's drift detection can flag if DKIM signing gets disabled for a domain that was previously enabled.
- **The Defender XDR alert pipeline.** When MDO detects a spoofing attempt that failed DMARC alignment, the resulting alert flows through to Panoptica365's alert engine.

For the actual DMARC reports — the daily XML aggregate reports — operators rely on a third-party DMARC monitoring platform; [mailsec.ca](https://mailsec.ca/) is the one we recommend, with Postmark, Valimail, dmarcian, or Mailhardener as workable alternatives. Panoptica365 doesn't ingest these today.

## What this means for the operator

Three takeaways.

**`p=none` doesn't do anything.** A customer with DMARC at `p=none` is observably authenticated but operationally unprotected. Receivers still let spoofed mail through. The journey to `p=quarantine` and then `p=reject` is the work that makes DMARC actually defend the customer.

**Alignment is the concept that catches operators.** SPF and DKIM can both "pass" while the visible `From:` header is forged. DMARC's alignment requirement is what makes the trio actually catch the spoofing the opening anecdote describes.

**DomainGuardian for diagnosis, mailsec.ca for reports.** The audit-the-DNS work is L1-friendly with the right visual tool. The reading-DMARC-reports work needs a real reporting platform for SMB scale — XML files don't scale to a 30-customer book. mailsec.ca is the one we recommend; Postmark, Valimail, dmarcian, or Mailhardener are workable alternatives. Pick one per MSP and use it for every customer.

## What's next

- **Lesson 5: Auto-forwarding and inbox rules.** The post-compromise indicator pair — what happens after authentication and Safe Links and DMARC have all been bypassed somehow.
- **Lesson 6: Mailbox auditing.** The audit posture that gives you visibility into what happened in a mailbox after the fact.

For now: open DomainGuardian, paste in the customer's primary domain, screenshot the result, and walk through the SPF / DKIM / DMARC findings with the customer. If they're at `p=none` or have no DMARC at all, the journey starts there. Two to three months of disciplined work gets a Stage-0 customer to Stage 3. Skip it and the customer stays one social-engineering email away from the call in the opening anecdote.

---

*Sources for the data points in this lesson — DomainGuardian email authentication checker ([domainguardian.nebiatek.com](https://domainguardian.nebiatek.com/)); mailsec.ca DMARC reporting platform ([mailsec.ca](https://mailsec.ca/)); Microsoft Learn on SPF in Microsoft 365 ([Microsoft Learn — Set up SPF](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-spf-configure)); DKIM signing configuration in M365 ([Microsoft Learn — Use DKIM to validate outbound email](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure)); DMARC overview and policy reference ([Microsoft Learn — Use DMARC to validate email](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dmarc-configure)); RFC 7489 (DMARC specification — alignment modes and policy semantics) ([RFC 7489](https://datatracker.ietf.org/doc/html/rfc7489)); ARC (Authenticated Received Chain) overview for forwarded mail ([Microsoft Learn — ARC](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-arc-configure)).*
