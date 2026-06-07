---
title: "AiTM phishing — the king of 2026"
subtitle: "Adversary-in-the-middle reverse proxies steal fully MFA'd session cookies — standard push-based MFA is no defence."
icon: "fish"
last_updated: 2026-05-29
---

# AiTM phishing — the king of 2026

If MFA fatigue is the social engineer's bypass of MFA, AiTM is the engineer's bypass. It doesn't ask the user to make a bad decision — it just lets them make a perfectly correct decision on a perfectly convincing fake. The user types their password, completes the MFA prompt, and walks away thinking nothing happened. Meanwhile the attacker now holds a fully MFA'd session cookie and can log in to M365 as that user from anywhere, on any device, until the cookie expires.

Microsoft tracked a **146% increase in AiTM attacks in 2024** and the curve has not bent down since. The phishing kits that automate this attack — Evilginx, Muraena, Modlishka — are free, open-source, and easy to deploy. The cost barrier to running an AiTM campaign has effectively gone to zero. Standard push-based MFA is no defence.

This is the deepest, longest lesson in the card because AiTM is the highest-impact identity attack of the moment. Read slowly.

## What "adversary in the middle" actually means

Imagine you have a phone call routed through an operator who can listen, take notes, and disconnect at any time. Both ends think they're talking to each other. The operator hears everything.

Now make the operator a website. The user types `outlook.office.com` into the browser. Or, more accurately, the user *clicks a link in an email* that looks like `outlook-office.com.signin-microsoft.help` (a domain registered six hours ago). That domain is the operator — a reverse proxy. It forwards every HTTP request to the *real* Microsoft sign-in service, and forwards every response back to the user. From the user's screen, everything looks normal. Microsoft's actual login page. Microsoft's actual MFA prompt. Microsoft's actual "Stay signed in?" question.

The only thing different is the URL bar. And nobody reads the URL bar.

What the operator-in-the-middle is capturing is not the password (although it does get the password). It's the **session cookie** — the thing Microsoft sends back after a successful sign-in to say "this browser is now authenticated until 4 PM on Friday." Once the AiTM site has that cookie, the attacker can paste it into their own browser, and they *are* the user. No more password needed. No more MFA needed. The token is the prize.

This is why the rest of this card and the next two cards keep coming back to *session protection* as the real game. The password is incidental; the session is what matters.

## Step by step

Walking through a real AiTM attack:

**Step 1: The phishing email arrives.** "Action required: Your DocuSign envelope is awaiting your review." The link looks like `secure-docusign.helpfile-portal.com/?eid=ABC...`. The user clicks.

**Step 2: The user lands on what looks like a Microsoft sign-in page.** Pixel-perfect. URL bar shows the attacker's domain but the user doesn't look. They type their email address.

**Step 3: The AiTM proxy forwards that email address to `login.microsoftonline.com`.** Microsoft, helpfully, returns the *actual tenant branding* for that user's company — the customer's logo, custom welcome text, the works. The proxy forwards all of that back to the user. The page now looks even more legitimate, because it *is* the legitimate page, just routed.

**Step 4: User types password.** Proxy captures it, forwards to Microsoft. Microsoft replies with "MFA challenge required." Proxy forwards the MFA prompt to the user.

**Step 5: User completes MFA.** Microsoft Authenticator number-matching, FIDO2 key tap, whatever the user's configured method is — all of it gets forwarded faithfully through the proxy. The user is doing exactly what they normally do.

**Step 6: Microsoft returns a session cookie.** This is the prize. The proxy captures it before forwarding to the user. The user's browser now has a working session and lands on the real Outlook. They believe they have signed in successfully. As far as Microsoft is concerned, they have.

**Step 7: The attacker imports the captured cookie into their own browser.** They are now signed in as the user. No password challenge. No MFA prompt. Microsoft sees a browser presenting a valid, MFA'd session token and grants access.

**Step 8: The attacker does whatever they came for.** Read mail, set up forwarding rules, search for "wire transfer" or "invoice" in the user's inbox, register a new MFA device for themselves (so they don't need to do this whole dance again), maybe pivot laterally. The session cookie expires after some hours, but by then the attacker has either persistence elsewhere or has finished their work.

The entire flow takes minutes. The user often never knows it happened — they completed sign-in, saw their mail, closed the tab, went on with their day.

## Why MFA doesn't help

This is the part that confuses people who came up in security ten years ago. MFA was supposed to be the answer. Why doesn't it stop this?

Because MFA proves *the user is present at the sign-in moment*. It does not prove *the sign-in is going to the right place*. The AiTM proxy puts itself between the user and Microsoft, and MFA validates correctly with the proxy in the middle. The user proves they're present; the proxy steals the result.

This is the structural flaw that token theft exploits in general, and AiTM exploits in particular. The defence has to be something that *binds the authentication to a specific destination*, not just to the user.

That's what phishing-resistant MFA does — and why it actually matters.

## Phishing-resistant MFA: what's different

**FIDO2 security keys, passkeys, and Windows Hello for Business** use a cryptographic technique called *origin binding*. When the user registers a passkey for `login.microsoftonline.com`, the passkey is mathematically tied to that specific domain. When the user later signs in, the browser tells the passkey what domain it's authenticating against. If the domain is `outlook-office.com.signin-microsoft.help` instead of `login.microsoftonline.com`, the passkey *refuses to sign*.

The user can't override this. The proxy can't proxy around it, because the cryptographic signature includes the domain as a signed field. There is no way to fool a passkey into signing for the wrong site.

That is the meaningful technical defence against AiTM, and it is the *only* defence that works at the authentication moment itself. Everything else in this lesson is mitigation that happens after the token is captured.

Three phishing-resistant methods you'll see in the field, with their tradeoffs:

**Passkeys** — store the private key on the user's phone (sync passkeys) or device (device-bound passkeys). Best UX. Most universal. Microsoft has been pushing passkey adoption hard since late 2024.

**FIDO2 security keys** — hardware token (YubiKey, etc). Best security posture; requires physical possession. Slightly more friction (carry a key, plug it in). Right for high-value users — admins, finance, executives.

**Windows Hello for Business** — biometric or PIN tied to a TPM-backed credential on a managed Windows device. Excellent UX if the user is on a managed Windows endpoint. Doesn't extend to mobile or non-Windows.

If the customer is on Business Premium or above, all three are configurable. The migration is gradual but the work compounds: every user who switches becomes immune to AiTM, MFA fatigue, and credential stuffing simultaneously.

## What else helps (the secondary mitigations)

Phishing-resistant MFA is the core defence. The rest of the controls in this list are *risk reduction* — they shrink the blast radius of an AiTM compromise, or they raise the chance of detection.

**Conditional Access: require compliant device.** If the captured session cookie is replayed from a device that isn't enrolled in Intune and marked compliant, Microsoft rejects it. The attacker stole the cookie but can't use it. This control is enforceable from Business Premium up. It's one of the strongest practical defences for tenants that can't get to passkeys overnight.

**Conditional Access: require Microsoft Entra hybrid join.** Variant of the above for tenants with hybrid AD. Same idea — token only usable from a known device.

**Token Protection** (preview-to-GA evolution in 2024-2026). A Microsoft feature that cryptographically binds the issued token to the device that requested it. Without the device's secret, the bound token is useless to an attacker who stole the cookie. Currently supports Exchange Online, SharePoint Online, and Teams; not yet universal. Available in Entra ID P1 (Business Premium and above) via Conditional Access session controls. Worth turning on where supported.

**Continuous Access Evaluation (CAE).** Real-time revocation of tokens when user conditions change. If the user is detected as compromised, or if their group membership changes, or if their location changes mid-session, tokens get revoked within minutes rather than at expiry. Available across most M365 SKUs. Enable it.

**Microsoft Defender SmartScreen + web content filtering.** SmartScreen flags known phishing domains in real time. Defender for Endpoint's web content filtering can block newly-registered domains entirely (most AiTM domains are days or hours old). Neither is a complete defence — first-day domains aren't flagged yet — but together they meaningfully reduce hit rate.

**Defender for Office 365 Safe Links.** URL rewriting and time-of-click checks. When the user clicks a link in their email, Defender for Office 365 re-checks the URL against current threat intelligence before redirecting. Catches links that became known-malicious between when the email was sent and when the user clicked.

## What Defender XDR does about it (Attack Disruption)

The single most useful thing Microsoft has built for AiTM in the last three years is **Attack Disruption** — the auto-action capability covered in card 1, lesson 4. It applies specifically to AiTM (and BEC, and HumOR, and password spray).

When Defender XDR correlates a high-confidence AiTM incident — typically detected via the combination of a Defender for Office 365 alert (user clicked an AiTM phishing site), a Defender for Cloud Apps anomaly (stolen session token being used), and an Entra ID Protection risk signal — it doesn't wait for an operator. It disables the user account in Entra ID, revokes all active sessions including the stolen cookie, and (if the attacker's device can be identified) contains it.

This is the modern "after-the-fact" defence. The attack happened; the token was stolen; the attacker briefly had access. Attack Disruption cut the access off before the damage spread. The operator sees the closed incident in the morning with a "compromised account disabled automatically" note.

Two practical notes:

**Verify before re-enabling.** When Attack Disruption fires, the operator will get a customer support call ("I'm locked out!"). Resist the urge to re-enable the user immediately. First verify that the AiTM was real (look at the source IP, the geographic anomaly, the timing), reset the user's password, kill any new authentication methods the attacker may have registered, *then* re-enable. Disrupting and re-enabling without forensics defeats the protection.

**Attack Disruption requires the right product mix.** Defender for Endpoint in active mode, Defender for Cloud Apps connected, Defender for Identity for on-prem signals if you have it, Defender for Office 365 P1 minimum. Most modern Business Premium tenants have the prerequisites; some don't. Check before you assume Attack Disruption is on.

## What Panoptica365 sees

Several alert categories in Panoptica365 are AiTM-triggered:

**Foreign-IP successful sign-in.** When a user who normally signs in from one country suddenly has a successful sign-in from another, the alert fires. Most AiTM attackers proxy their replay through the same infrastructure used to host the phishing kit, which is rarely in the user's normal geography.

**Impossible-travel sign-in.** Two successful sign-ins from the same user separated by physical impossibility (Toronto, then Bucharest, 90 minutes apart). Classic post-AiTM signal — the user is in Toronto, the attacker replayed their cookie from Bucharest.

**New authentication method registered.** Attackers like to add their own MFA method after a successful AiTM so they don't have to repeat the whole dance. This shows up in the Entra audit log and Panoptica surfaces it as an alert.

**Suspicious mailbox forwarding rule created.** The user wouldn't be creating a rule that forwards all `invoice OR payment OR wire` mail to a Gmail address. That's an attacker. Forwarding-rule and inbox-rule alerts come up frequently in AiTM follow-on activity.

**Defender XDR AiTM incidents** ingested directly. When Microsoft has scored an incident as AiTM and either disrupted it or alerted, that arrives in Panoptica365 as a high-severity alert with the original Microsoft severity and analysis preserved.

The triage approach: when you see *any* of these alerts on a user, assume AiTM until you can prove otherwise. Pull the Entra sign-in log for the user, look for the sign-in that immediately preceded the suspicious activity, check the source IP and the user-agent. A successful sign-in from a residential IP in a country the user has never been to, with a default browser user-agent, on the same day as a foreign-IP alert — that's the pattern. Treat it as a compromise.

## What this means for the operator

Four takeaways for daily work.

**AiTM is the single most important threat to design defences against in 2026.** It is the attack that defeats the MFA most customers think is protecting them. Every conversation you have about identity hardening should reach passkeys / FIDO2 / Hybrid join / compliant-device CA before it reaches anything else.

**Push-based MFA is no longer adequate for high-value users.** Admins, finance, executives, anyone with access to sensitive data — these users should be on phishing-resistant methods. Use Conditional Access authentication strength policies to *require* phishing-resistant MFA for sensitive apps even when the user's default method is still push.

**Token Protection and CAE are not optional.** Turn them on for every Business Premium and above tenant. They don't prevent AiTM at the authentication moment, but they shrink the window during which a stolen token is useful.

**Trust Attack Disruption, then verify.** When Defender XDR fires Attack Disruption on a user, the right operator workflow is: confirm the action looks correct, gather forensics, fix the underlying compromise (new auth methods, mailbox rules, etc.), then re-enable. Not the other way around.

## What's next

- **Lesson 4: OAuth consent phishing.** The attack that survives a password reset. AiTM is loud; consent phishing is quiet, and it lasts.
- **Lesson 5: Device-code abuse.** Microsoft's device-code flow misused. Closer to AiTM in mechanic, but with a different payload.
- **Lesson 6: BEC.** The economic endgame. What the attacker actually does with the AiTM-acquired session.

For now: AiTM is the attack that taught the industry MFA-alone is not enough. The defences exist. The work is operational — migrate to phishing-resistant methods, enable Token Protection and CAE, configure Attack Disruption, train customers' users to never trust the URL bar. It's tractable. It's just not done yet.

---

*Sources for the data points in this lesson — Microsoft Defender Threat Intelligence on AiTM attack rise ([Microsoft Security Blog — Defeating adversary-in-the-middle](https://www.microsoft.com/en-us/security/blog/2022/07/12/from-cookie-theft-to-bec-attackers-use-aitm-phishing-sites-as-entry-point-to-further-financial-fraud/)); 2026 AiTM technique landscape ([Jeffrey Appel — AiTM/MFA phishing 2026 edition](https://jeffreyappel.nl/)); Token Protection mechanics ([Microsoft Learn — Token protection in Conditional Access](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-token-protection)); Continuous Access Evaluation ([Microsoft Learn — Continuous access evaluation](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-continuous-access-evaluation)); Attack Disruption configuration ([Microsoft Learn — Configure automatic attack disruption](https://learn.microsoft.com/en-us/defender-xdr/configure-attack-disruption)); FIDO2 / passkey origin binding ([Microsoft Learn — Passwordless authentication](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-passwordless)).*
