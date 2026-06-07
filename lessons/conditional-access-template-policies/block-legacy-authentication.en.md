---
title: "Block legacy authentication — closing the basic-auth bypass"
subtitle: "Why IMAP and SMTP AUTH can bypass MFA entirely, and how one CA policy closes that loophole across all users and apps."
icon: "ban"
last_updated: 2026-05-29
---

# Block legacy authentication — closing the basic-auth bypass

You enable Require MFA for all users on Monday morning. By Tuesday afternoon, the attacker who already had a user's password from a 2019 LinkedIn breach signs in to that user's mailbox over IMAP. No MFA prompt. No challenge. No alert. Just a successful sign-in to a mailbox they shouldn't have access to.

The MFA policy didn't help because IMAP doesn't speak MFA. Neither does POP3, nor SMTP AUTH, nor any of the half-dozen other "legacy authentication" protocols that Microsoft has been trying to retire for a decade. To a CA policy that says "require MFA," a legacy auth client signs in *as if MFA were never asked for*. The user has correct credentials. There's no MFA prompt. The sign-in succeeds.

This is the loophole the Block Legacy Authentication template closes.

**Panoptica365 - Block Legacy Authentication.** Grant: None (i.e., block). Users: All users. Apps: All cloud apps.

It is the paired policy to lesson 2. Without it, Require MFA for all users has a hole. Together, they close the most common credential-theft attack path in M365.

## What is "legacy authentication," exactly

The term covers any authentication protocol that doesn't support modern features like MFA, Conditional Access, or token binding. The main offenders:

- **Basic authentication** — the username-and-password-over-HTTP-Basic-Auth protocol. Used historically by Outlook for Mac, Mail.app on iOS before iOS 11, scripted SMTP senders.
- **IMAP / POP3 / SMTP AUTH** — the classic email protocols. Used by third-party mail clients, scan-to-email devices, old scripts.
- **Exchange ActiveSync (EAS) basic auth** — the variant of ActiveSync that doesn't support modern auth. Used by older mobile mail clients.
- **MAPI over HTTP basic auth** — the legacy MAPI variant. Used by very old Outlook clients.
- **Outlook Anywhere (RPC over HTTP) basic auth** — same family.

Microsoft has been retiring these for years. In October 2022, they disabled basic auth for most Exchange Online protocols. In 2023 and 2024, they extended the deprecation to the remaining legacy paths. By 2026, the surface area is significantly smaller than it was — but pockets remain, and any pocket is a hole.

The non-legacy alternative is **modern authentication** — OAuth 2.0-based, supports MFA, supports Conditional Access, supports token-based session controls. Every supported M365 client since 2020 speaks modern auth.

## Why this policy is still needed in 2026

If Microsoft has retired most legacy auth, why ship a policy that blocks it?

Three reasons:

**1. The retirement is incomplete.** Microsoft turned off basic auth for *most* Exchange Online protocols, but the off-by-default state doesn't mean off-everywhere. Some service principals can still authenticate via legacy paths. SMTP AUTH is still available (Microsoft has been re-enabling and re-disabling it tenant by tenant for years). Specific tenants that requested exceptions during the deprecation may still have basic auth on for one or more protocols.

**2. Customers re-enable basic auth.** When a customer's old scan-to-email device stops working, the path of least resistance is to call Microsoft support and ask them to re-enable basic auth for SMTP. Some customers have. The CA policy is what catches that decision — and prevents it from being made silently.

**3. Some non-Microsoft applications still use it.** Third-party apps that integrate with M365 over IMAP or SMTP — older marketing automation tools, line-of-business apps with hardcoded credentials, the occasional self-built script — speak legacy auth by design. The CA policy forces a conversation: either modernise the integration, or document the exclusion.

The CA policy is the durable backstop. Microsoft's protocol-level deprecation can be reversed at the tenant level; a CA policy that's enabled and monitored cannot be reversed silently.

## What it does

The policy mechanics are simple:

- **Grant: Block.** Sign-ins matching the policy are denied outright. No MFA prompt, no challenge — just rejected.
- **Conditions: Client apps = Other clients.** This is the CA condition that captures everything that *isn't* modern auth: Exchange ActiveSync basic auth, IMAP, POP3, SMTP AUTH, MAPI over HTTP, and a few others. The policy applies only to sign-ins from those legacy clients; modern-auth sign-ins are not affected.

So a user opening Outlook (modern auth) is unaffected; an old script trying SMTP AUTH from a Linux box is blocked. The user experience for the vast majority of users is *no change* — they're already on modern auth and don't notice.

## What can break when you turn it on

The pre-flight matters here, because legacy-auth blocking is one of the policies most likely to surface unknown integrations.

Common breakage:

**Scan-to-email on printers.** Older multifunction printers were configured years ago to send email via SMTP AUTH with a service account. When legacy auth is blocked, the printer can no longer send. The fix: either reconfigure the printer to use a modern SMTP relay (most modern printers support OAuth 2.0 SMTP now) or move scan-to-email through a connector that handles the legacy path.

**Old line-of-business apps with hardcoded SMTP credentials.** Many internal apps have a "send email when this happens" feature configured with hardcoded SMTP credentials from 2017. They fail silently when blocked. The customer notices when a workflow that used to send notifications stops sending.

**Third-party CRM / marketing tools with IMAP-based email integration.** Old Salesforce integrations, old HubSpot setups, custom email-parsing tools. Some still default to IMAP. Most modern versions support OAuth 2.0 IMAP, but legacy installations may not have been upgraded.

**Macs running old Mail.app versions.** Pre-iOS 11 / pre-macOS 10.14 Mail.app uses basic auth. Users on truly old hardware can't connect. The fix is usually "your computer is too old to authenticate to a modern enterprise mail system; here's a $400 budget for a new one." This conversation is uncomfortable but correct.

**Custom PowerShell scripts that send mail.** Internal scripts using `Send-MailMessage` with hardcoded credentials. The fix is to migrate to `Send-MailKitMessage` or use Graph API.

Each of these is a *known* legacy-auth use case the operator finds during the Report-only window. None of them is a reason to *not* enable the policy — they're reasons to plan the cutover carefully and migrate the affected integrations.

## Rollout

This template deploys in Enabled state like the others, but with one important difference: **legacy-auth breakage is harder to predict than MFA breakage**. Service accounts that only authenticate once a quarter (for the year-end report, for the recurring invoice batch) don't show up in the pre-flight inventory or in the first week of monitoring. Their failure manifests months later.

For that reason, the manual Report-only step in the Entra portal is **strongly recommended for this specific policy regardless of tenant size**, even on small-business tenants where the other templates can deploy hot. Deploy via Panoptica365 (creates the policy in Enabled state), then immediately flip the policy to Report-only in the Entra portal, and run a *14-day* Report-only window.

During the Report-only window, pull the sign-in log filtered to "Required Block — Report-only result, Client = Other clients." Inventory:

- Which users? (Service accounts mostly; some real users on old clients.)
- Which protocols? (SMTP AUTH is the most common.)
- Which IPs / devices? (Printers, scripts, third-party integrations.)

Then work through the inventory:

- For each legitimate use case, identify a modernisation path, or accept that the account stays on legacy auth and document the exclusion in Panoptica365 with a sunset date.
- For each suspicious or unknown sign-in, treat as potential compromise — same playbook as the credential-stuffing response in card 2 lesson 1.

Communicate to users with old clients about the upcoming change. Provide modernisation instructions. Then flip the policy back to Enabled in the Entra portal.

The 14-day Report-only window for legacy auth is longer than for most policies because legacy-auth use cases hide in monthly and quarterly cycles. A 3-day window misses too many quiet integrations.

## What to monitor after enforcement

**Sign-in attempts with `Other clients` that succeed.** Should be zero after enforcement (the policy blocks them). Any successful sign-ins via legacy paths means a policy gap — an exclusion that's too broad, or a protocol the policy doesn't cover.

**Sign-in attempts with `Other clients` that fail with a CA block.** Should be the normal daily noise — attackers probing, old scripts on excluded accounts. Pay attention to the *source*. A burst of legacy-auth attempts on multiple accounts from a single IP is credential-stuffing using a botnet that hasn't kept up with modern auth.

**Drift on the policy.** The same drift detection that applies to Require MFA applies here. If the policy gets disabled or its scope narrows, somebody (the customer's other admin, a Microsoft support technician) has loosened the perimeter.

## The order matters

Block Legacy Auth should be enabled *after* Require MFA, not before. Reasoning:

- Require MFA covers all modern-auth sign-ins. The MFA policy puts the second factor in front of the password-only path.
- Block Legacy Auth covers all non-modern-auth sign-ins. The blocking policy puts a wall in front of the password-only path that *doesn't* support MFA.

Together, they close the surface: any sign-in either has MFA (modern) or is blocked outright (legacy). There is no path through with only a password.

If you enabled Block Legacy Auth *first*, MFA-less modern-auth sign-ins would still succeed. If you enabled Require MFA *first* without Block Legacy Auth, legacy-auth sign-ins would still succeed. The pair has to be deployed together; the order is "MFA first, then Block Legacy Auth a few days later." The MFA policy can be enabled with broader scope and lower breakage risk; Block Legacy Auth then closes the remaining hole.

## What Panoptica365 sees

The successful detection of attempts blocked by this policy comes through the standard sign-in log ingestion. Three signals that matter:

- **A burst of legacy-auth blocks** on multiple accounts from a single IP — credential stuffing via a legacy protocol. Same triage as the modern-auth credential stuffing pattern.
- **An unexpected successful legacy-auth sign-in** — somebody loosened the policy. Investigate.
- **An exclusion list that grew unexpectedly** — drift on the policy itself, surfaced by Panoptica365's CA drift detector.

The Daily Activity donut surfaces the volume of CA blocks in near-real-time, including the legacy-auth blocks. After enforcement, the legacy-auth block volume should be a steady low number (attackers probing) with no spikes.

## What this means for the operator

Three takeaways.

**Block Legacy Auth is the companion to Require MFA, not a replacement.** Both are needed. The MFA policy covers the path users use; the Block Legacy Auth policy covers the path attackers prefer.

**The Report-only window is longer here than for other policies.** Legacy-auth use cases hide in monthly and quarterly automations that don't show up in a 3-day Report-only sample. Budget two weeks.

**Resist the customer pressure to make broad exclusions.** "Our printer needs SMTP AUTH" is true; "we need to exclude the entire IT department" is not. Each exclusion is a specific account on a specific IP with a documented use case and a sunset date. Broad exclusions are how this policy gets compromised in slow motion.

## What's next

- **Lesson 4: Trusted location OR compliant device.** The next CA layer — location-based with a smart escape valve for compliant devices.
- **Lesson 5: Compliant OR hybrid OR MFA.** The upgrade path that uses device-trust signals to reduce friction on managed-device sign-ins.

For now: this policy plus Require MFA from lesson 2 are the baseline. Until both are enabled and verified on a customer tenant, none of the more sophisticated CA work in later lessons matters — the credential-only attack path is still open.

---

*Sources for the data points in this lesson — Microsoft Learn on legacy authentication and basic auth retirement ([Microsoft Learn — Deprecation of Basic authentication in Exchange Online](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online)); Conditional Access "Other clients" condition reference ([Microsoft Learn — Conditional Access: Client apps condition](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-conditions#client-apps)); modern authentication overview ([Microsoft Learn — Modern authentication](https://learn.microsoft.com/en-us/microsoft-365/enterprise/modern-auth-for-office-2013-and-2016)).*
