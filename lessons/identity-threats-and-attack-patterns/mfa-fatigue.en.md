---
title: "MFA fatigue — the Uber story"
subtitle: "How attackers flood users with push notifications until they approve one — and why push-based MFA is socially engineerable."
icon: "bell-ring"
last_updated: 2026-05-29
---

# MFA fatigue — the Uber story

On September 15, 2022, an 18-year-old contractor at Uber tapped "Approve" on a Microsoft Authenticator push notification at home, late in the evening, after his phone had been buzzing for about an hour. He was not signing into anything. The attacker on the other end of the prompt then sent him a WhatsApp message claiming to be from Uber IT, telling him the push notifications would stop if he just approved one of them.

He approved.

By the morning, the attacker — later identified as part of the Lapsus$ group — had pivoted from that one approved push to read access on Uber's internal Slack, the AWS console, the Google Workspace admin, the HackerOne bug bounty platform, and the company's source code. The intrusion went public when the attacker started posting screenshots in Uber's own engineering Slack channels announcing they were there.

That is MFA fatigue. The Uber incident is the canonical case study, and the attack pattern is alive and well in 2026.

This lesson is why push-based MFA is socially engineerable, what number matching and additional context do (and don't) fix, and how to push customers toward authentication methods that can't be fatigued.

## What's actually happening

MFA fatigue (also called "MFA bombing" or "push bombing") requires the attacker to already have the user's password. Often this came from a credential dump (lesson 1). The MFA prompt is the only thing standing between the attacker and the account.

The attack mechanics are embarrassingly simple:

1. Attacker has username + password. Enters them into `login.microsoftonline.com`.
2. Entra ID requests MFA — sends a push notification to the user's phone via Microsoft Authenticator.
3. User sees the prompt, knows they didn't try to sign in, dismisses it.
4. Attacker enters the password again. Another push.
5. Attacker repeats. Five pushes. Ten. Twenty. The user is asleep at 2 AM, or in a meeting, or just exhausted.
6. Eventually, the user either misclicks "Approve" instead of "Deny," or gives up and approves to make the buzzing stop, or the attacker adds a social-engineering layer ("Hi, I'm from IT, the system is glitching, please just approve so we can finish the test").
7. Attacker is in.

The whole attack has *no technical sophistication*. It works because human beings get tired and irritated, and because the dismiss-or-approve binary doesn't communicate any context.

## Why this works specifically against push notifications

Three flavours of MFA exist in M365, and the fatigue attack works on exactly one of them.

**SMS / phone call MFA.** Not vulnerable to fatigue in the same way — the attacker can dial the user once per attempt, but rapid repeated calls trip carrier-level abuse detection and aren't free. SMS has *other* problems (SIM swapping, intercept) that make it the weakest MFA method overall, but fatigue isn't one of them.

**Push notification MFA (the Authenticator default).** Vulnerable. Pushing a notification is free for Microsoft, so an attacker can fire dozens per minute. The user sees `Approve / Deny` with maybe a username and an app name. They're being asked to make a yes/no decision based on near-zero context.

**Number matching + additional context.** Push notifications, but the user has to type a two-digit number shown on the sign-in screen into the Authenticator app, and the prompt now shows the requesting app's name plus the geographic location of the sign-in attempt. *This is now the Microsoft default* for Authenticator and has been since 2023.

**Phishing-resistant MFA (FIDO2 keys, passkeys, Windows Hello for Business, certificate-based).** Not vulnerable to fatigue at all. The user has to physically touch the key, present their face, or insert a smart card. There is no "tap to approve" — the cryptographic operation requires presence. We'll spend lesson 3 of this card showing why phishing-resistant MFA matters for AiTM too.

## How well does number matching actually solve this?

Number matching makes the attack harder, not impossible. Three things change:

**The user has to actively read a number from the sign-in screen and type it into their Authenticator app.** Misclicking "Approve" no longer works — there's no Approve button to misclick. The user has to do something *intentional*. This kills the "rolled-over in bed and tapped Yes" failure mode.

**The additional context shows the application name and the geographic location.** "Sign-in from Microsoft Outlook in Bucharest, Romania" should set off alarms even for a tired user in Montreal. (Whether it actually does depends on how attentive the user is at 2:14 AM, but at least the information is there.)

**The attacker now needs a social-engineering layer.** Without number matching, the attack is purely mechanical — push, repeat, wait. With number matching, the attacker has to *talk* to the user to get them to type the number. That usually means a WhatsApp message, a Teams message, or a phone call claiming to be from IT.

So number matching converts MFA fatigue from a pure annoyance attack into one that requires social engineering. That's a real improvement. It's also why every campaign in 2025 and 2026 that hits a number-matching tenant comes packaged with a social-engineering pretext — exactly what happened to Uber.

What number matching does *not* do: make the user immune to a convincing social-engineering pitch. If the attacker can fake an IT-help phone call well enough that the user actively types the two-digit code, the attack still works. Number matching raises the bar; it doesn't eliminate the class.

## What this looks like in M365 telemetry

When MFA fatigue is in progress, Microsoft sees:

- **A burst of failed sign-in attempts on one account**, all with correct password (because the attacker has the password) but no MFA completion. These appear in the Entra sign-in log with the result "MFA challenge required, not completed."
- **A successful sign-in immediately after the burst**, when the user finally approves.
- **Often, follow-on activity from a new device** — the attacker is now signing in from their own machine using the MFA-approved session.

Entra ID Protection (P2 only, E5) can score this pattern as suspicious and trigger risk-based CA controls. At Business Premium (P1), the burst-of-failed-MFA pattern doesn't automatically generate a high-confidence Microsoft alert, but the *successful* sign-in from a new country or new device should still trigger Panoptica365's foreign-IP and impossible-travel detectors.

Defender XDR can also fold these signals into an incident if the user goes on to do something noisy — register a new MFA device, create an inbox rule, send mail to themselves at a Gmail address. That's the BEC pattern from lesson 6.

## What Panoptica365 sees

Three signals from MFA fatigue:

**The burst of failed sign-in attempts in near-real-time** via the Daily Activity widget on the tenant dashboard. The donut chart refreshes roughly every 15 minutes and shows the breakdown of sign-in outcomes — successful authentications, failed authentications, and Conditional Access blocks. During an MFA fatigue attack the failed-authentication slice of the donut bulges visibly. Watch for sudden spikes concentrated on *one user or a small group* — that's the MFA fatigue pattern. Distributed-across-many-users is credential stuffing (lesson 1); concentrated-on-one-user is MFA fatigue or a targeted credential attack.

**The successful sign-in itself.** When the user eventually approves and the attacker gets in — typically from a foreign IP or in impossible-travel proximity to the legitimate user — the alert fires in your queue.

**The follow-on activity.** Inbox rule creation, mailbox forwarding, mailbox-permission grants, sometimes new admin role assignments — these post-compromise actions are typically louder than the sign-in event itself. The card 6 lesson on BEC covers them in detail.

Telling MFA fatigue apart from credential stuffing and AiTM matters for the customer's incident report. In MFA fatigue, the Entra sign-in log will show a burst of MFA challenges that weren't completed, followed by one that was — and Panoptica365's Daily Activity donut will have already shown the failed-authentication spike in near-real-time. In credential stuffing the password worked without MFA being required at all (because the user had no MFA enrolled). In AiTM (lesson 3) the MFA *was* completed by the user, just on a fake site. The remediation is similar in all three; the lessons learned are different.

## Defending against MFA fatigue

Defences, ordered by impact:

**Migrate users to phishing-resistant MFA.** Passkeys, FIDO2 security keys, Windows Hello for Business. None of these can be fatigued — they require a physical interaction the attacker cannot replicate. The migration is gradual (users need to enrol passkeys), but every user who switches is removed from the attack surface entirely. This is also the right answer for the AiTM problem in lesson 3, so the work compounds.

**Ensure number matching is enabled** for any tenant still using Authenticator push. It's been the Microsoft default since 2023, but older tenants or custom-policy tenants may have it disabled. Check via the Entra ID authentication methods policy. Panoptica365's Security Settings Engine monitors this.

**Train customers' users to *never* approve a prompt they didn't initiate.** This sounds obvious. It isn't. The most effective version of this training is a short one-pager that includes the line "Microsoft will never call you to ask you to approve a sign-in prompt." Put it in onboarding for new users. Refresh quarterly.

**Set up alerting for unusual MFA registration events.** When an attacker successfully fatigues a user, the next thing they often do is *register their own MFA device* — so they don't need to fatigue the user again later. The Entra audit log captures this as an "Authentication method registered" event. It's one of the highest-value signals for catching a compromise *while the attacker still has only a foothold*.

**On regulated customers, mandate phishing-resistant MFA via Conditional Access authentication strength policies.** "Require phishing-resistant MFA for access to financial systems" is a CA policy that's available in Entra ID P1 (Business Premium and up). This is how you protect the high-value users without forcing the whole tenant to passkeys overnight.

## What this means for the operator

Three takeaways.

**A successful sign-in following a burst of failed-MFA attempts is a compromise.** Treat it like one. Disable the user's current sessions, force a password reset, require fresh MFA enrolment, audit recent mailbox activity. Don't wait for the BEC pattern to develop before responding.

**The Authenticator app is good. Push notifications via the Authenticator app are weaker than passkeys.** This is a real and meaningful distinction, and you should be comfortable making it in customer conversations. The customer who insists they "already have MFA, everyone uses the app" is overstating the protection. Number matching helps; phishing-resistant methods solve.

**Service accounts almost never need MFA fatigue mitigation, because service accounts almost never have MFA at all.** This is its own problem (covered in lesson 1, in passing). Service accounts compromised via credential stuffing don't get fatigued; they just get used. But the related lesson is the same: anywhere there's an account without phishing-resistant authentication, MFA fatigue (or worse) is on the table.

## What's next

- **Lesson 3: AiTM phishing.** The technical bypass of MFA. Where fatigue tricks the user into approving a real prompt, AiTM tricks the user into approving a prompt on a *fake site that proxies the real Microsoft sign-in*. The attacker captures the session cookie instead of fighting MFA at all.
- **Lesson 6: BEC.** The endgame of every successful compromise from lessons 1, 2, and 3 — what the attacker actually does once they're in.

For now: MFA fatigue is the social-engineering bypass of MFA. It works because push notifications are designed to be tapped quickly. Number matching makes it harder but not impossible. The real answer is phishing-resistant methods, and the work to migrate customers toward them starts the day you take this lesson seriously.

---

*Sources for the data points in this lesson — Uber September 2022 incident overview ([Uber Newsroom — Security update](https://www.uber.com/newsroom/security-update/)); Lapsus$ attribution and tradecraft analysis ([Microsoft Security Blog — DEV-0537 / Lapsus$](https://www.microsoft.com/en-us/security/blog/2022/03/22/dev-0537-criminal-actor-targeting-organizations-for-data-exfiltration-and-destruction/)); Microsoft Authenticator number matching default rollout ([Microsoft Learn — Number matching for Microsoft Authenticator](https://learn.microsoft.com/en-us/entra/identity/authentication/how-to-mfa-number-match)); Entra ID authentication strength policies ([Microsoft Learn — Conditional Access authentication strengths](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-strengths)).*
