---
title: "Device-code abuse — the printer that wasn't a printer"
subtitle: "State-sponsored actors (Storm-2372) weaponise the legitimate device-code auth flow to steal tokens without ever touching a password."
icon: "smartphone"
last_updated: 2026-05-29
---

# Device-code abuse — the printer that wasn't a printer

Somewhere in your customer's office, a printer signs in to Microsoft 365 to scan-to-email. That printer can't have a keyboard. It can't type a password. It can't tap a phone for MFA. Microsoft solved this years ago with the *device code flow*: the device displays a short alphanumeric code on its screen, the user goes to `microsoft.com/devicelogin` on their phone or laptop, enters the code, signs in normally, and Microsoft hands the device a token. The printer can now send mail. Nobody had to retype a password into a device with no keyboard.

It is a clever, legitimate feature. It is also the attack vector behind Storm-2372 — a Russia-aligned threat actor that has been running device-code phishing campaigns against governments, NGOs, IT services, defence, telecoms, healthcare, higher education and energy targets across Europe, North America, Africa and the Middle East since August 2024. As of February 2025, Microsoft observed Storm-2372 evolving the attack to acquire Primary Refresh Tokens (PRTs) by registering attacker-controlled devices inside the victim's tenant.

This lesson is how a printer-friendly authentication feature becomes an attack tool, and the one Conditional Access policy that shuts it down for customers who don't have printers.

## The legitimate device-code flow

To understand the attack, walk through the legitimate version first.

A printer (or smart TV, IoT device, PowerShell session on a server, scripted automation, etc.) wants to authenticate as a user. It cannot present a sign-in UI itself.

**Step 1: Device requests a code.** The device calls Microsoft's `/devicecode` endpoint and receives back two things: a short *user code* (eight or so alphanumeric characters like `B7XK-9MNP`) and a longer *device code* (a long opaque string the device keeps internally). The device also gets a URL — `microsoft.com/devicelogin`.

**Step 2: Device displays the user code.** The printer's screen shows: "Go to `microsoft.com/devicelogin` and enter code `B7XK-9MNP` to sign in."

**Step 3: User goes to that URL on their phone or laptop.** Authenticates normally to Microsoft. When prompted, enters the user code. Microsoft now associates that code with the user's signed-in identity.

**Step 4: Device polls Microsoft's token endpoint.** Once the user has entered the code, Microsoft hands the device a token. The device can now sign in as the user.

It works. It's legitimate. Microsoft has documented the flow extensively. The flaw is that *steps 2 through 4 don't actually require the device to be in the same room as the user*. The "device" can be the attacker's laptop in Bucharest. The "user code" can be sent via WhatsApp. The user has no way of knowing what device the code is going to authenticate.

## The attack

Now the attack version, which is structurally identical:

**Step 1: Attacker's laptop requests a device code.** They call Microsoft's `/devicecode` endpoint with a client ID — typically one of Microsoft's well-known legitimate first-party application IDs (Outlook, Teams, Microsoft Graph PowerShell, Microsoft Authentication Broker). Microsoft returns the user code and the device code.

**Step 2: Attacker sends the user code to the victim.** Via WhatsApp, Teams, Signal, or email. Storm-2372 typically poses as a "prominent person relevant to the target" — a journalist arranging an interview, an investor scheduling a call, a researcher inviting collaboration. The pretext culminates in: "I've set up a Teams meeting for us. Please go to `microsoft.com/devicelogin` and enter the code `B7XK-9MNP` to join."

**Step 3: Victim, expecting a legitimate Teams meeting invite flow, goes to the URL and enters the code.** They're now on Microsoft's *real* devicelogin page. They authenticate normally — password, MFA, the whole regular flow. There is no fake login page. There is no proxy. The page is genuinely Microsoft's. The user code, however, is the attacker's.

**Step 4: Microsoft authorises the attacker's laptop as that user.** The attacker now has an access token — issued legitimately, by Microsoft, after the victim correctly completed MFA. From Microsoft's perspective, this is a fully valid sign-in.

**Step 5: Attacker reads mail, exfiltrates data, etc.**

The user's experience is: they thought they were joining a Teams meeting. The meeting didn't happen. They closed the tab. They got owned.

## Why this defeats MFA

MFA happens between *the victim and Microsoft* in step 3. The victim completes it correctly. The MFA prompt asks "Approve sign-in from the device that started this flow?" — but the device that started this flow is the *attacker's* laptop. The victim can't tell from the prompt that the device isn't theirs, because the device-code flow doesn't surface any meaningful information about the requesting device in the user's MFA experience.

Microsoft's MFA validates user presence and correct credentials. It does not validate intent ("did this user actually want to sign this attacker's machine in?"). The device-code flow uses MFA as designed and still produces a compromise, because the *consent to the sign-in* and the *authentication of the sign-in* happen on different machines.

This is structurally the same problem as AiTM (lesson 3): the authentication is technically correct but it ends up benefiting the wrong party. The difference is that AiTM intercepts the user's session cookie; device-code phishing has Microsoft *legitimately issue* an attacker-bound token. There is no theft. There is no malware. There is no proxy. It is all official.

## Storm-2372's recent evolution

In August 2024 Microsoft started tracking Storm-2372's device-code campaigns. Initial campaigns were straightforward — phish for an Outlook or Microsoft Graph PowerShell token, read mail.

On February 14, 2025, Microsoft observed the actor shift to a much more dangerous variant: using the specific client ID for the **Microsoft Authentication Broker**. When the device-code flow is run against the Authentication Broker, the resulting refresh token can be exchanged for a fresh token at the *device registration service*, which lets the attacker register their own machine as a device in the victim's Entra ID tenant.

A registered device in Entra ID can request a Primary Refresh Token (PRT) — the credential M365 issues to managed Windows devices to keep a user signed in. With a PRT, the attacker has the same kind of access a fully enrolled corporate laptop has. They can sign in to anything in M365 without further MFA prompts, because the PRT is what *replaces* MFA for managed-device sign-ins.

In other words, the attacker turned a single device-code phish into an *enrolled device* in the customer's tenant. Going from "I have a token for a few hours" to "I have a managed-device identity that will keep producing tokens" is a step change in persistence — similar to what OAuth consent phishing (lesson 4) gives the attacker, but achieved through a completely different mechanism.

## What this looks like in M365 telemetry

The device-code flow is logged. The sign-in log in Entra ID records:

- **Authentication protocol: Device Code.** This is the give-away. Very few real customer workloads use device code flow as their primary sign-in method.
- **Client ID.** Tells you what application was being authorised. The Microsoft Authentication Broker ID (`29d9ed98-a469-4536-ade2-f981bc1d605e`) showing up here is a strong signal — that's the Storm-2372 evolution.
- **Source IP.** Often a residential proxy or known-hostile geography.
- **User agent.** Often default Python or curl-style — automation, not a real client.

If you grep the Entra sign-in log for `authenticationProtocol == "deviceCode"`, you should see almost zero results in a healthy tenant unless there are documented IoT/automation use cases. Every hit is worth investigating.

The follow-on activity — sudden registration of a new device in the tenant, new authentication methods registered, mailbox-permission changes — is louder and easier to detect than the device-code sign-in itself.

## What Defender does about it

Microsoft Defender for Office 365's Safe Links can catch the *delivery* of the phishing message if it's email-based, but Storm-2372's pretext is typically a chat message in Teams, WhatsApp, or Signal, which Defender for Office 365 doesn't see.

Defender XDR can correlate the device-code sign-in with downstream anomalies — new device registration, suspicious Graph queries, mailbox exfiltration — and assign Attack Disruption confidence if the pattern matches. The Microsoft Threat Intelligence team has published detection queries that customers with Defender XDR can deploy in advanced hunting to look for the specific Storm-2372 indicators.

The cleanest defensive control, however, is configuration: prevent the device-code flow from being usable for most users in the first place.

## The Conditional Access policy that shuts this down

In Conditional Access, there's a condition called **Authentication flows** (preview through 2024, generally available in 2025). Inside that condition, one of the toggles is **Device code flow**. You can write a CA policy that says:

> Block all users from completing the device code authentication flow, with the following exceptions: [specific accounts that legitimately need it, like the printer's service account or the helpdesk account that runs PowerShell automation against multiple tenants].

That's the policy. Set it on the customer's tenant, exclude any service accounts that legitimately need device code (most tenants have none), and Storm-2372's entire playbook stops working for that tenant.

This is one of the highest-leverage single CA policies available in Entra ID P1 (Business Premium and above). Microsoft started publicly recommending it after the Storm-2372 disclosure in February 2025, and as of mid-2026 it should be considered table-stakes for any tenant that doesn't have a documented device-code use case.

The follow-on cleanup, if you discover the policy wasn't in place and an attack happened: revoke the user's tokens (covered in lesson 3's response section), de-register any attacker-controlled devices from the tenant's device list, audit and clean up authentication methods, and reset the user's password.

## What Panoptica365 sees

Panoptica365's UAL ingestion pipeline includes device-code-related signals as part of the broader detection catalogue:

**Suspicious device-code sign-ins.** When a sign-in completes with `authenticationProtocol == "deviceCode"` and the source isn't a documented IoT account, the alert can fire — depending on tenant configuration.

**New device registered.** When a previously-unseen device appears in the tenant's device list (the post-Storm-2372 attack signature), the registration event is in the Entra audit log and Panoptica365 surfaces it.

**New authentication method registered.** As with most identity attacks, the post-compromise attacker often adds their own MFA method. This alert covers the device-code attack chain as well as the AiTM and credential-stuffing chains.

**Defender XDR ingestion** picks up correlated incidents when Microsoft has scored the activity as suspicious.

The triage approach: when a foreign-IP sign-in or a new-device-registered alert fires, check whether the sign-in's authentication protocol was Device Code. If yes, treat as Storm-2372-style attack until proven otherwise.

## Defending the customer

Layered, in order of impact:

**Block device code flow via Conditional Access for users who don't need it.** Single policy, immediate effect. The vast majority of customer tenants have zero legitimate device-code use cases. The few that do (the printer, the PowerShell automation account) can be excluded individually. Don't leave this exposed.

**For tenants that do need device code (rare), require it to come from trusted locations or compliant devices.** The Conditional Access condition combines with the others — you can require "device code flow only from the office IP range" or "only on Intune-compliant devices." Heavier configuration but possible.

**Educate users about chat-based pretexts.** The Storm-2372 attack chain depends on the user trusting a WhatsApp/Signal/Teams message enough to follow instructions. Train users (especially executives and people in roles like grants, journalism, research, or any external-facing function) that **anyone asking them to go to `microsoft.com/devicelogin` and enter a code via a chat message is almost certainly an attacker**. There is no legitimate reason an external party should ever send a device code via chat.

**Monitor for the `deviceCode` protocol in the sign-in log.** This should be a near-zero baseline in most tenants. Anything non-zero is worth examining.

**Detect post-compromise indicators.** New device registration events, new authentication methods, suspicious mailbox activity — these are the follow-on signals that fire louder than the initial device-code sign-in.

## What this means for the operator

Three takeaways.

**Add "block device code flow" to the customer onboarding checklist.** This is one of the cheap, high-impact Conditional Access policies that should be on every Business Premium tenant by default. Panoptica365's CA template library is the right place to ship this; if it isn't already in your library, add it before next customer onboarding.

**Storm-2372's evolution from "steal a token" to "register a device" is the pattern to watch.** When attackers find new ways to convert short-lived access into persistent access, the threat compounds. The same logic applies to consent phishing (lesson 4) and to the post-AiTM "register a new MFA method" trick (lesson 3). The persistence variants are where simple compromises become extended incidents.

**Device-code phishing is best caught upstream.** Once the token is issued, you're chasing the attacker's footprint. The CA policy that prevents the flow from being usable is *the* defence; everything after that is mopping up.

## What's next

- **Lesson 6: Business email compromise.** Where most of these attacks end — not in the dramatic compromise itself, but in the quiet, weeks-long manipulation of finance emails that follows. BEC is what makes all five of the preceding attacks profitable for attackers.

For now: the device-code flow is a legitimate feature being abused at scale by a sophisticated actor. The defence is configuration, not detection. Set the Conditional Access policy. Train your users to never enter a device code from a chat message. Watch the sign-in log for the protocol you don't expect to see.

---

*Sources for the data points in this lesson — Microsoft Security Blog on Storm-2372 device-code phishing campaign ([Microsoft Security Blog — Storm-2372 conducts device code phishing campaign, February 2025](https://www.microsoft.com/en-us/security/blog/2025/02/13/storm-2372-conducts-device-code-phishing-campaign/)); device code flow technical reference ([Microsoft Learn — OAuth 2.0 device code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)); Conditional Access "authentication flows" condition ([Microsoft Learn — Conditional Access: Authentication flows](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-cloud-apps#authentication-flows)); Storm-2372 evolution to Authentication Broker / PRT theft ([Microsoft Threat Intelligence — Storm-2372 update, February 2025](https://www.microsoft.com/en-us/security/blog/2025/02/13/storm-2372-conducts-device-code-phishing-campaign/)).*
