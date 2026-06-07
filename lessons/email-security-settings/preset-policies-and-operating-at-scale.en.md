---
title: "Preset security policies and operating email security at scale"
subtitle: "Using Microsoft's Standard and Strict preset policies to enforce consistent email security posture across every managed tenant."
icon: "layers"
last_updated: 2026-05-29
---

# Preset security policies and operating email security at scale

A junior tech, two weeks into the job, asks the senior on a Tuesday afternoon: "When did you last look at Customer X's security settings?"

The senior thinks for a second. "Honestly? Their annual review six months ago. Before that, the onboarding back in 2024."

"So you don't *check* them?"

"I don't *check*. Panoptica365 checks. Every poll cycle, every setting, every customer. If anything drifts — somebody flips off MailTips because a user complained, a new mailbox gets created and doesn't inherit the strict audit posture, the outbound spam policy action gets weakened — I get an alert. I act on the alert. Then I move on. The settings panel is where I go *when an alert fires*, not somewhere I patrol."

"So you really set it and forget it?"

"Set it, configure it, document the exceptions in the customer's notes, then yes — let the drift detector do the watching. The alerts queue is where I spend my time. That's the whole point of the model. Without it, I'd be opening 28 customer dashboards every Monday morning to verify nothing changed. With it, the changes come find me."

This lesson is about how that scales. The Standard and Strict preset security policies that give you most of card 5's controls in one bundle. The alert-driven operational model that turns a 28-customer book into a manageable triage queue rather than a manual-inspection chore. The annual deep dive that catches the things drift detection can't. And the customer-specific exception ledger that keeps you from re-doing the same per-tenant work every year.

## Microsoft's preset security policies — Built-in, Standard, Strict

Microsoft ships three preset security policy levels in Defender for Office 365. Each is a bundle of pre-configured policies covering anti-spam, anti-phishing, anti-malware, Safe Links, and Safe Attachments — all the MDO surfaces card 5 has covered. Each preset includes the *settings*, the *scoping* (who gets which preset), and the *quarantine policy mappings* for the messages those settings catch.

- **Built-in protection** — minimal baseline. Applies to every mailbox in every tenant automatically. Not configurable. This is the floor.
- **Standard preset** — sensible defaults for most customers. User impersonation protection enabled with reasonable thresholds. Anti-phishing actions set to quarantine. Safe Links and Safe Attachments enabled with Dynamic Delivery. Quarantine policies set to AdminOnlyAccessPolicy for high-confidence phish, malware, and spoof. This is the right choice for the majority of SMB tenants.
- **Strict preset** — tighter thresholds across the board. Anti-phishing more aggressive (more messages get quarantined). Bulk threshold lower (more bulk mail gets caught). AdminOnlyAccessPolicy extended to Phishing (not just High-confidence). This is the right choice for regulated industries, higher-risk customers (legal, finance, accounting), or customers with a recent compromise history.

For both Standard and Strict, you assign the preset to users, groups, or domains. The preset then drives the configuration for those scopes. Whatever isn't covered by Standard or Strict falls back to Built-in protection.

## What's actually in the Standard preset

Worth being concrete about, because most of card 5 maps directly to settings the preset configures:

- **Anti-phishing** — user impersonation enabled (configure protected users explicitly), domain impersonation enabled, anti-spoofing on, mailbox intelligence enabled. Actions on detection: quarantine.
- **Safe Links** — protection enabled, click-time URL checking on, user override disabled, Office apps protection on (the SafeLinks-for-Office expansion).
- **Safe Attachments** — protection enabled, Dynamic Delivery action.
- **Anti-malware** — common attachment block list applied.
- **Anti-spam (inbound)** — bulk threshold and spam thresholds set to Standard's mid-range values.
- **Quarantine policy mapping** — AdminOnlyAccessPolicy for High-confidence phish, Malware, Spoof; DefaultFullAccessWithNotificationPolicy for Spam and Bulk.

What Standard does *not* configure (you have to handle these separately even with the preset):

- The list of users protected by impersonation protection (preset enables the feature; you specify who).
- Custom trusted-senders entries (per-customer, per-relationship).
- The outbound spam policy (separate from the preset).
- Mailbox audit posture, MailTips, Remote Domain forwarding control, SMTP AUTH submission disable — these all live outside the preset and need their own configuration. These are the seven Exchange-category settings Panoptica365 monitors.

## Standard vs Strict — when to use which

The honest framing:

**Use Standard for:**
- The default SMB customer
- Any tenant where you haven't been asked for stricter defences
- Customers without specific regulatory drivers
- The first deployment to a new customer (you can tighten later)

**Use Strict for:**
- Customers in regulated industries — healthcare, finance, legal, government contracting
- Customers with a history of compromises in the past 12 months
- Customers where the business value of email-borne data is high (M&A, IP-heavy, deal-driven)
- Customers who've asked for "the strongest protection you can give us" (and accepted the trade-offs in the customer conversation)

You can also mix per user/group scope. The CEO, CFO, and finance team get Strict; the rest of the company gets Standard. This is reasonable when one part of the org has higher target value than the rest.

## The preset + custom overlay pattern

Presets give you a defensible default; custom policies give you tenant-specific tuning. The pattern that works at MSP scale:

1. **Deploy a preset (Standard or Strict) as the foundation** to all users.
2. **Layer a custom policy with higher priority** that adds the customer-specific bits: the named protected users for impersonation, the trusted-senders list for legitimate partners, the per-customer thresholds where they diverge from the preset.
3. **Treat the preset as untouchable** — when a customer asks for a change, the change goes in the custom overlay, not the preset.

This keeps the preset's curated tuning intact (so Microsoft's updates to it flow through automatically) while letting you tailor where it matters. The trade-off is having two policies per customer instead of one; the upside is that you can answer "is this customer still on Microsoft's recommended baseline?" with a yes.

One quirk worth knowing: **preset policy rule names are timestamped**. When you create a preset, Microsoft generates rule names that include the creation timestamp — `Standard Preset Security Policy123456789...`. If you script preset creation or look up presets via PowerShell, use wildcard matching (`Get-EOPProtectionPolicyRule -Identity 'Standard*'`) rather than exact names, because the name will be unique per tenant and per creation event.

## Operating at scale — the alert-driven model

Card 5 ships with seven Exchange-category security settings Panoptica365 monitors per tenant:

1. Disable Automatic Forwarding to External Domains (Critical)
2. Enable Mailbox Auditing for All Users (Critical)
3. Enable Preset Security Policy (Standard or Strict) — MDO (Critical)
4. Strict Mailbox Audit Posture (Bypass + Action List) (Critical)
5. Enable MailTips (All Tips + External Recipients) (High)
6. Configure Anti-Spam Outbound Policy (Restrict Compromised Accounts) (High)
7. Disable Basic Auth for SMTP AUTH Submission (High)

Once configured at a customer tenant, you don't need to revisit them on any schedule. Panoptica365 polls every setting on every customer continuously. When a setting drifts from its configured value — somebody flips MailTips off in the Exchange admin centre, a new mailbox is created without the strict audit posture, the outbound spam policy gets weakened in response to a false-positive ticket — Panoptica365 fires a drift alert. The alert goes to the operator team via the standard pipeline: it shows up in the alerts dashboard, it generates an email notification, it's attributed to the specific customer with the specific setting that changed.

The operator's at-scale workflow is therefore reactive, not proactive:

- **Triage the alerts queue.** Open the alerts dashboard at whatever cadence makes sense for the team (most MSPs glance daily; the alert email notifications mean nothing slips by even if you don't). Every drift alert is something a customer's tenant did that you should know about.
- **For each alert, decide the response.** Open the affected security setting. Read the History tab — what was the previous value, what's the new value, when did it change, who or what likely caused it. Decide:
  - **Apply** — reset to the recommended value. The default action; appropriate when the drift is a routine accident or a known event (new mailbox provisioned, etc.).
  - **Accept the drift** — leave the new value in place, document the reason. Appropriate when the change is an intentional customer-driven decision that you've validated.
  - **Investigate further** — when the drift pattern is suspicious enough to warrant a deeper look before responding. Compromised admin account, unauthorised configuration change, unexpected pattern across multiple settings.
- **Document non-routine decisions in the customer's notes.** Routine "new mailbox drifted, reapplied" doesn't need much. Accepted drifts always need a reason in the ledger (covered below). This is what makes the annual review tractable.

This is what makes the model work at MSP scale. You're not manually inspecting customer postures every Monday; you're responding to a small number of alerts per week as they surface. A 28-customer book typically generates a handful of drift alerts per week — most of them the routine new-mailbox cases that resolve with an apply click. The alerts that aren't routine are by definition the ones worth your attention.

## The annual review — what to verify in depth

The weekly drift review catches the operational drift — new mailboxes, accidental disables, Microsoft default changes. It doesn't catch *configuration debt*: customer-specific exceptions that accumulated, trusted-sender entries that no longer serve a purpose, per-mailbox SMTP AUTH overrides for printers that have since been replaced, Remote Domain entries for partners the customer no longer works with.

Once per year, per customer — synchronised with the security review or contract renewal conversation — do the deeper audit:

- **Anti-phishing protected users.** Is the list still current? Has the CFO changed? Is there a new controller? Are there ex-employees still in the list?
- **Trusted senders.** Each entry should have a documented reason. Entries without a reason get removed.
- **Remote Domain entries** (per-domain auto-forward exceptions). Each one should reference a documented business relationship. Old entries for ex-partners get removed.
- **Per-mailbox SMTP AUTH overrides.** Each should have a documented legacy device or app. Devices that no longer exist; apps that have been replaced — remove the override.
- **Transport rules.** The four-question audit from lesson 8 — purpose, owner, still-needed, defence impact — applied to every rule.
- **Custom quarantine policies.** Same audit pattern.
- **Mail flow rules** added by the customer since the last review. Did anything new appear that you didn't authorise?
- **The customer's mailbox count.** Is it growing or shrinking? Are there abandoned mailboxes (ex-employees) that should be cleaned up?

Document the findings. Remove the dead weight. Reaffirm the surviving exceptions. The annual review is how you stop the customer's configuration from becoming a graveyard of decisions made by people who no longer remember why.

## Customer-specific exceptions — the ledger

Every customer accumulates legitimate exceptions over time. The discipline that keeps the at-scale model sane is *writing them down in one place per customer*.

A minimal customer exception ledger:

- **Anti-phishing trusted senders** — domain, scoped protection, reason, added date, approving operator.
- **Quarantine policy exceptions** — non-default policy assignments, reason, approving operator.
- **Remote Domain auto-forward exceptions** — domain, reason, approving operator.
- **Per-mailbox SMTP AUTH overrides** — mailbox, device/app, reason, planned migration target, approving operator.
- **Transport rules** — rule name, purpose, owner, last reviewed date.
- **Custom mail flow rules** — same.
- **Preset security policy customisations** — what's overridden in the custom overlay, why.

This is a document, not a configuration system. Markdown, Word doc, ticket-system page — whatever the MSP uses. The point is that any operator picking up the customer's account can read the ledger and understand why every exception exists, and the annual review has a checklist to work against.

Without the ledger, every annual review starts from scratch — operators have to reverse-engineer the customer's configuration to understand whether each exception is still needed. With the ledger, the review takes an hour instead of a day.

## What Panoptica365 sees

The Panoptica365 customer dashboard surfaces, per tenant:

- **All security settings with current state** (green / drift / unmonitored). The Exchange-category section contains card 5's seven settings; other sections handle other surfaces.
- **History per setting** — what the value has been over time, when it changed.
- **Apply action per setting** — reapply the recommended value when drift is detected.
- **The standard alert pipeline** for high-severity events: Restricted Users events from the outbound spam policy, suspicious transport rule creation, suspicious inbox rule patterns, Defender XDR-ingested incidents from MDO.

What Panoptica365 does *not* surface in the dashboard: a cross-customer fleet aggregation, a "every customer at a glance" matrix, a comparison view between two customers' settings, a built-in customer-exception ledger. The cross-customer work is per-customer click-through, one Monday-morning review at a time. The ledger lives outside Panoptica365 — in the MSP's documentation system, the ticket platform, or wherever the customer notes are kept.

## What can break (at scale)

**Customer-specific tuning gets lost when staff turns over.** The operator who configured the customer two years ago left; the operator inheriting the account doesn't know why the trusted senders list looks the way it does. The exception ledger is the antidote. Make creating ledger entries part of the change workflow — no exception goes in without a ledger note.

**Microsoft updates the preset defaults and customers behave differently.** Microsoft occasionally tightens or loosens preset configurations. Customers using presets get the new behaviour automatically. Sometimes this is good (free improvement); sometimes it surprises users who experienced a behaviour change they don't understand. Watching Microsoft's email-security release notes is worth doing; communicating major preset changes to customers proactively is the differentiator.

**Drift alerts pile up unaddressed during busy weeks.** When the team is under-resourced, drift alerts are the easy thing to deprioritise — "I'll get to that on Friday." The cost is invisible until a real compromise pattern is sitting in the queue waiting to be triaged. Treat alert triage as non-optional; route alert notifications somewhere everyone sees them; assign clear ownership for each tenant or shift.

**Annual reviews stretch from annual to "whenever we get to it."** The drift detector covers the operational drift, but it doesn't catch configuration debt — stale trusted senders, abandoned Remote Domain entries, per-mailbox SMTP AUTH overrides for printers that were retired. The annual review is the only thing that catches those. Calendar them; bill for them; make them a deliverable customers see in their service report.

## What this means for the operator

Three takeaways.

**Presets are the foundation; customisation is the differentiator.** Deploy Standard or Strict to every customer as the default. Layer a custom overlay for the customer-specific protected users, trusted senders, and tuning where it matters. Treat the preset as Microsoft's curated baseline that you don't touch; treat the overlay as the place customer-specific decisions live.

**Drift detection turns at-scale email security from impossible to reactive.** Without drift detection, the only honest way to operate 28 customers' email postures would be a manual inspection routine no MSP can sustain. With drift detection, you configure once, document the exceptions, and let the alerts come find you. The operator's job becomes triaging a small queue of real events — not patrolling for hypothetical drift.

**The exception ledger is the unsexy discipline that compounds.** Every legitimate exception documented is one fewer mystery for the operator who inherits the customer. Every annual review with a ledger is an hour instead of a day. The MSPs that win at this scale aren't the ones with the cleverest defences — they're the ones who write things down and look at them once a year.

## Closing card 5

You've now seen the email-hardening posture across ten lessons:

1. Pre-flight inventory and licensing reality
2. Anti-phishing impersonation protection — the SMB BEC gap
3. Safe Links and Safe Attachments — the MDO P1 features customers pay for
4. SPF, DKIM, DMARC — the email authentication trio
5. Auto-forwarding and inbox rules — the post-compromise indicator pair
6. Mailbox auditing — the forensic record you only miss when you need it
7. Quarantine policies and user release — where good defaults go to die
8. Mail flow rules and MailTips — the surgical tools and the warning lights
9. Outbound spam and SMTP AUTH — controlling the blast radius
10. Preset security policies and operating at scale — what we just covered

The arc: turn on what the customer paid for, configure it correctly, watch for drift, document the exceptions, review annually. Email security is not about deploying a silver bullet — it's about layered defences applied with discipline. The customer who never gets BEC'd is the one whose MSP did all ten lessons of work, not the one who turned on Safe Links and called it done.

## What's next

- **Card 6: Secure Score.** Microsoft's tenant-wide security posture metric, how to interpret it, where it misleads, and how the MSP work in cards 3, 4, and 5 maps to specific Secure Score recommendations.

For now: open Panoptica365's alerts queue. Triage anything sitting there. If the queue is short — most weeks it is — close the tab and go do something else. That's how the model is supposed to feel. The drift detector is doing the watching so you don't have to.

---

*Sources for the data points in this lesson — Microsoft Learn on preset security policies overview ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)); Standard and Strict preset configuration differences ([Microsoft Learn — Recommended settings for EOP and MDO](https://learn.microsoft.com/en-us/defender-office-365/recommended-settings-for-eop-and-office365)); preset security policies management via PowerShell ([Microsoft Learn — Manage preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)); built-in protection scope reference ([Microsoft Learn — Built-in protection](https://learn.microsoft.com/en-us/defender-office-365/mdo-support-teams-about)); EOPProtectionPolicyRule cmdlet for preset rules ([Microsoft Learn — Get-EOPProtectionPolicyRule](https://learn.microsoft.com/en-us/powershell/module/exchange/get-eopprotectionpolicyrule)).*
