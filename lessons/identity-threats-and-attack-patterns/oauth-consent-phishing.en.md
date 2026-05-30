---
title: "OAuth consent phishing — the attack that survives a password reset"
subtitle: "Tricking users into granting a malicious app OAuth permissions gives attackers persistent mailbox access that outlasts any password change."
icon: "link"
last_updated: 2026-05-29
---

# OAuth consent phishing — the attack that survives a password reset

A user gets an email: "View shared file in PerformanceReview-Pro." They click. A familiar-looking Microsoft consent dialog pops up. The dialog says, "PerformanceReview-Pro would like permission to: read your mail, send email as you, read all files you have access to." The user is in a hurry. They click "Accept."

There is no password to type. No MFA prompt. Nothing that *feels* like an attack. The dialog looks like the consent dialogs the user sees once a month for legitimate apps. Two seconds and a click, and the user has just handed an attacker persistent access to their mailbox and files.

Three weeks later, the security team resets the user's password because of some unrelated alert. The attacker is still inside the mailbox. Because the attacker never needed the password.

This is OAuth consent phishing, and it is the quietest dangerous attack in the M365 ecosystem.

## Why this attack is structurally different

Every other attack in this card relies on getting the user's *authentication* — their password, their MFA, their session cookie. The user changes their password and the attack ends.

OAuth consent phishing doesn't touch authentication. It convinces the user to grant a third-party application *permission* to access their data on their behalf. Microsoft issues that application a refresh token that's tied to the *application*, not to the user's password. The application can now request fresh access tokens whenever it wants, indefinitely, until either the user revokes the consent or an admin disables the application's enterprise registration.

Resetting the user's password doesn't revoke the consent. Disabling the user's account doesn't always revoke the consent (depending on the configuration). Forcing the user to re-MFA doesn't revoke the consent. The consent is the attack, and the consent is sticky.

That's what makes this attack uniquely valuable to attackers in 2026: *persistence*. Most compromises end at password reset. This one doesn't.

## The OAuth flow, briefly

OAuth 2.0 is the legitimate protocol that lets you say "I want to use this calendar app, and the calendar app needs to read my Outlook calendar." Instead of giving the app your Microsoft password (which would be reckless), you log in to Microsoft, Microsoft asks if you're sure you want to give the app the specific permissions it's asking for, and if you say yes, Microsoft hands the app a token it can use to act on your behalf for those specific permissions.

This is a *good* protocol. Every legitimate productivity integration uses it — your Zoom plugin, your Calendly, your Trello, your AI assistant of the week. The pattern is fine.

The attack abuses the pattern. The attacker registers a malicious app in Entra ID (either their own tenant or a compromised tenant), gives it a convincing name, and tricks users into consenting to it. The protocol works correctly; the user clicked the button. From Microsoft's perspective, the consent is legitimate.

## What permissions matter

Not all OAuth scopes are equally dangerous. The Microsoft Graph permission catalogue is sprawling, and a useful triage shortcut is to look at three things:

**Delegated vs. application permissions.** Delegated permissions act *as the user* — the app can do whatever the user can do. Application permissions are *standalone* — the app can act on behalf of the entire tenant without a user being present. Application permissions are far more dangerous and require admin consent (you can't approve them as a regular user). Most consent-phishing attacks target delegated permissions because those go through a normal user consent flow.

**Read vs. ReadWrite.** A `Mail.Read` scope lets the app read mail. A `Mail.ReadWrite` scope lets it send mail and modify mailbox state. Read alone is bad; ReadWrite is much worse. Look for `.ReadWrite`, `.Send`, `.Manage`, `.All` in the requested scopes — those are the high-value ones.

**Mail, Files, Contacts, Calendar — the data scopes.** `Mail.ReadWrite`, `Files.ReadWrite.All`, `Contacts.Read`, `Calendars.Read`. These are what attackers want. A malicious app with `Mail.ReadWrite` can read every email the user has and send mail as them. That's enough to run a BEC operation entirely through OAuth, with no password ever changing hands.

**The killer scope: `offline_access`.** This is the one that grants a refresh token. Without it, the app can only act while the user is interacting. With it, the app can act on the user's data indefinitely, even when the user isn't online. Almost every legitimate productivity app requests this, which is why it doesn't look suspicious. Almost every malicious one does too.

## What the user sees

The consent dialog is Microsoft's last line of defence, and it works only as well as the user reads it.

Most users see something like this and click Accept without reading:

> **PerformanceReview-Pro** wants to:
> - Sign you in and read your profile
> - Read your mail
> - Have full access to your mailbox
> - Maintain access to data you have given it access to
> - Read all files that you have access to

If the user reads, the warning signs are there. "Read your mail" is not a thing most apps need. "Have full access to your mailbox" is the killer. "Maintain access to data you have given it access to" is the `offline_access` scope by another name.

But people don't read consent dialogs. Microsoft's research from their consent-phishing guidance is unambiguous on this: users click through dialogs almost universally if the app name looks plausible. The dialog is a defence-in-depth control; it is not, by itself, the defence.

## How an attacker registers the malicious app

Two paths, both common:

**Path 1: register in their own tenant.** The attacker creates a free Microsoft developer tenant, registers an app there, and configures the app to support multi-tenant authentication. The app can then be invoked against any other tenant's users. The attacker controls the app and receives all the tokens consented to it.

**Path 2: register in a previously compromised tenant.** If the attacker has already breached one tenant (via AiTM, credential stuffing, or anything else), they can register an app there and then use that app to phish users at other tenants. The app's `publisher` field shows the compromised tenant's name, which sometimes adds a layer of false legitimacy ("oh, this is from a vendor we work with").

In either case, the malicious app eventually gets reported to Microsoft and disabled — but "eventually" is days to weeks, and the attacker has the consent tokens by then. Disabling the app afterward does not retroactively revoke already-issued tokens.

## How the email arrives

The phishing email is typically one of three pretexts:

**The "shared file" pretext.** "View shared file in [Plausible App Name]." Click leads to a consent dialog for an app that allegedly hosts the file.

**The "your AI/security/productivity tool" pretext.** "Your account has been provisioned for [Plausible Tool]." Click leads to a consent dialog under the guise of onboarding.

**The OAuth-as-MFA-bypass pretext.** "Sign in to verify your identity for HR / IT / Finance." Most sophisticated variant. The user thinks they're authenticating; they're actually consenting.

All three present the *real Microsoft consent dialog* because the attacker is using the legitimate OAuth protocol against Microsoft's actual endpoints. There is no fake URL bar to notice. The only signal available to the user is the *content* of the consent dialog — which, as established, they're not reading.

## What Microsoft does about it

A few defences are in place by default; some require configuration.

**App publisher verification.** Microsoft offers a "publisher verified" badge for apps from confirmed organisations. Users can be configured to only consent to verified apps. This is meaningful — getting verified requires a Microsoft Partner registration and some non-trivial paperwork — but unverified apps are still allowed by default in most tenants.

**User consent policies (Entra ID).** The admin can restrict what permissions users can consent to without admin approval. Microsoft revised these options in late 2024 / 2025, so the menu in the Entra portal today looks like this:

- *Do not allow user consent.* Everything requires admin approval. Very secure, often too restrictive for organisations with legitimate productivity integrations.
- *Allow user consent for apps from verified publishers, for selected permissions.* Users can consent to verified-publisher apps or apps registered in the user's own organisation, and only for permissions Microsoft classifies as "low impact." The explicit, predictable middle ground.
- *Let Microsoft manage your consent settings* (Microsoft's recommended option as of 2025, and the new default in fresh tenants). Microsoft auto-updates the tenant's consent policy to align with their current guidance. A sub-toggle — *Enable user consent for popular Mail clients* — allows users to consent to popular third-party mail apps for specific Mail permissions (Apple Mail, Thunderbird and similar). The sub-toggle is a usability concession most tenants need, but it does loosen the policy in the Mail-permissions corner of the surface.

The old "Allow user consent for all apps" option you may remember from the older Entra portal has been retired. That removal is itself a Microsoft acknowledgement that the default-permissive era is over.

For an MSP managing customer tenants, **the verified-publishers-and-low-impact option is usually still the better choice** — not because it's safer than the Microsoft-managed option in absolute terms, but because it's *predictable*. You know exactly what your policy is; you control when it changes; the audit trail is yours. "Let Microsoft manage" is appropriate for tenants without an MSP that want to stay current with Microsoft's evolving defaults; for tenants you manage, you want to be the one who decides what changes and when — and you want any policy shift to land in your change log, not Microsoft's release notes.

Whichever of the two non-blocking options you pick, the bulk of OAuth consent phishing attacks fail at the consent dialog stage because the malicious app isn't from a verified publisher and isn't asking for a "low impact" permission.

**Admin consent workflow.** When a user tries to consent to an app that exceeds their allowed permissions, they can submit an "admin consent request" instead. The admin reviews and either approves or rejects. This adds a human review step before high-permission apps get into the tenant.

**Defender for Cloud Apps anomalous app discovery.** MDA (E5 or as an add-on) detects unusual app behaviour — an app that suddenly starts accessing far more mailboxes than usual, or an app that wasn't seen yesterday but is exfiltrating data today. Alerts fire on the *behavioural* anomaly, which catches even apps that managed to slip through the consent dialog.

**Defender XDR Attack Disruption** also covers OAuth-abuse incidents — when MDA + sign-in correlation reaches high confidence that a consented app is exfiltrating, Disruption can disable the app and revoke its tokens.

## What revocation actually looks like

When you discover a malicious consented app — either via an alert or because the customer reported odd behaviour — the steps are:

**1. Identify the app in Entra ID.** Enterprise applications → search by name or by recent registration → find the malicious one. Confirm the suspicious permissions (Mail.ReadWrite + offline_access is the classic signature).

**2. Remove the user's consent.** For each affected user, the consent is in their `oauth2PermissionGrants` collection. The admin can revoke per-user or organisation-wide.

**3. Disable or delete the application's service principal.** This stops the application from authenticating at all. Done from the enterprise applications blade.

**4. Revoke all refresh tokens for affected users.** This is the *critical* step. Until the refresh tokens are revoked, the attacker can still mint access tokens. Use `Revoke-AzureADUserAllRefreshToken` (legacy) or the equivalent Graph API call. Note that Microsoft is in the middle of evolving how this works — some refresh tokens are bound to specific apps and survive user-level revocation. The safest move is to invalidate the user's password as well, even though that doesn't strictly disable the app.

**5. Audit the affected mailboxes.** Look for sent mail, forwarding rules, file downloads, anything the app might have done while it had access. Treat this as a confirmed compromise and run the full BEC-recovery playbook (lesson 6).

**6. Block the app's reply URL or the app's tenant.** If the malicious app is registered in a known-bad tenant, you can use Conditional Access to block sign-ins to that tenant.

The whole cleanup is more involved than a password-reset compromise. That's the point of the attack — it's chosen by attackers because it's hard to clean up.

## What Panoptica365 sees

OAuth consent phishing surfaces in Panoptica365 through several alert types:

**New OAuth grant alerts.** When a user consents to a new app in a customer's tenant, the consent appears in the Unified Audit Log and Panoptica365 can surface it (especially if the requested permissions include `Mail.ReadWrite`, `Files.ReadWrite.All`, or `offline_access`). The exact alert depends on whether the user-grant or admin-grant pattern was used.

**Defender for Cloud Apps anomalies** ingested via Defender XDR. When MDA detects that a previously-consented app is behaving anomalously (unusual volume of mailbox reads, sudden activity in a region the app has never been before, etc.), the resulting alert flows into Panoptica365.

**Suspicious app activity correlated with sign-ins.** When the same user's account shows OAuth grant + a follow-on event like a mailbox-permission grant or forwarding rule, both alerts will appear close together. Treat them as the same incident.

What Panoptica365 doesn't currently do is full per-tenant OAuth app inventory with risk scoring. The manual workflow today: when an alert fires, open the Entra portal's enterprise applications view for the customer's tenant, filter by recently consented, and review.

## Defending the customer

Layered defences, in order of impact:

**Set user consent to "verified publishers, low-impact permissions only."** This is the single highest-leverage configuration change. Eliminates most consent phishing at the dialog stage. For MSP-managed tenants, this explicit option is preferable to "Let Microsoft manage" because you control the policy and any change to it lands in your audit trail rather than Microsoft's release notes. Configure once per tenant.

**Implement admin consent workflow.** When users want to consent to apps beyond the allowed scope, they submit a request. Admin reviews. Adds a sanity check without blocking legitimate apps.

**Inventory existing consented apps periodically.** Every customer's Entra tenant has an enterprise applications list. Review quarterly. Look for apps with names you don't recognise, apps with broad permissions, apps that were granted by users who shouldn't be consenting to broad-permission apps. Remove anything suspicious.

**Train users to read consent dialogs.** Specifically: anything asking for `Mail.ReadWrite` or `Files.ReadWrite.All` from an unfamiliar publisher is almost always malicious. This is one of the few security trainings that has a concrete action ("look at the permissions, then either click Cancel or check with IT first").

**Use Conditional Access to require admin approval for new app sign-ins.** A CA policy can require admin approval before a user's first sign-in to a newly-registered app. Slows down the attack significantly.

**For E5 tenants, enable Defender for Cloud Apps and configure app-governance policies.** MDA can quarantine high-risk apps automatically and alert on anomalous behaviour. Worth enabling.

## What this means for the operator

Three takeaways.

**Consent is sticky; treat it like installing software.** Once a user consents to an app, that app has access until somebody explicitly revokes it. Treat OAuth consent the way you'd treat installing software on an endpoint — review, approve, document. Anywhere a customer's users can self-consent broadly, you have a hole.

**Mail.ReadWrite + offline_access is the OAuth equivalent of "ransomware-staging."** When you see this scope combo on an app, take a long look. There are legitimate apps that need it, but most don't, and the attacker apps almost always do.

**Cleanup is harder than for password compromises.** Plan accordingly. When the alert fires, allow more time than you would for a password-reset incident, because the steps are: identify the app, revoke per-user consents, disable the service principal, revoke refresh tokens, audit affected data, and reset the user's password just in case. Treat each consented-malicious-app incident as a small project, not a quick fix.

## What's next

- **Lesson 5: Device-code abuse.** Closely related to consent phishing in the sense that it abuses a legitimate Microsoft authentication flow. Storm-2372 — the Russia-linked actor — has been running device-code campaigns at scale since August 2024.
- **Lesson 6: BEC.** Where OAuth-acquired access often ends up — silent inbox monitoring, invoice manipulation, wire fraud.

For now: OAuth consent phishing is the quietest persistent compromise in the M365 catalogue. The defences are configuration-level — set user consent restrictions correctly and most attacks fail at the dialog. The cleanup is involved. The lesson for customers is that not every threat needs to use the password.

---

*Sources for the data points in this lesson — Microsoft Learn on user and admin consent settings ([Microsoft Learn — Configure user consent settings](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent)); OAuth consent phishing patterns ([Microsoft Learn — Illicit consent grant attacks](https://learn.microsoft.com/en-us/defender-office-365/detect-and-remediate-illicit-consent-grants)); Microsoft Graph permission reference ([Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)); Defender for Cloud Apps app governance ([Microsoft Learn — App governance](https://learn.microsoft.com/en-us/defender-cloud-apps/app-governance-manage-app-governance)); refresh-token revocation procedure ([Microsoft Learn — Revoke user access in an emergency](https://learn.microsoft.com/en-us/entra/identity/users/users-revoke-access)).*
