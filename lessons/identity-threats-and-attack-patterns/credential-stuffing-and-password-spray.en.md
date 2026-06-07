---
title: "Credential stuffing & password spray — the dumbest attacks that still work"
subtitle: "How recycled breach data and one-password-many-accounts attacks still compromise M365 tenants at scale."
icon: "key-round"
last_updated: 2026-05-29
---

# Credential stuffing & password spray — the dumbest attacks that still work

Somewhere on a Telegram channel right now, an attacker is paying $4 for a CSV file that contains 28 million email-and-password pairs scraped from a Dropbox breach in 2012. He doesn't care that the file is fourteen years old. He doesn't even care if 95% of the passwords have been changed. He's going to feed all 28 million pairs into a script that tries each one against `login.microsoftonline.com`, and somewhere in there, a few hundred will still work — because somewhere out there, a few hundred people used their Dropbox password as their M365 password, never changed it, and never enabled MFA.

That's credential stuffing. It is the most boring attack in the catalogue, and in 2026 it is still the entry point for a meaningful chunk of M365 compromises.

This lesson is about why the dumb attacks keep working, what they look like in Microsoft's telemetry, and where MFA earns its keep.

## The two flavours

There are two attacks in this lesson, and they're often confused because they look similar from Microsoft's side.

**Credential stuffing** uses *real* credentials harvested from breaches. The attacker has actual `email → password` pairs from somewhere (LinkedIn 2012, Adobe 2013, Yahoo 2014, MyFitnessPal 2018, LastPass 2022, pick a year). About one in a hundred will still work somewhere unrelated, because humans reuse passwords. The attacker runs the list against M365, gmail, banks, and every other service that takes an email-as-username.

**Password spray** flips it. Instead of *many* passwords against *one* account (which trips the lockout), the attacker tries *one* password against *many* accounts. "Spring2024!" against 50,000 email addresses, all in one slow sweep, paced low enough to evade per-account rate limits. About 0.5% of those accounts will be using "Spring2024!" because predictable seasonal passwords are an unkillable habit.

Both attacks share the same defining feature: **the attacker is using a password that genuinely works on the account.** From Microsoft's perspective, this is a *legitimate sign-in attempt with the correct credentials*. The signal that something is wrong has to come from *somewhere other than the password being wrong* — which is the entire challenge of detecting this class of attack.

## How Microsoft sees it

Microsoft sees a lot of these. Hundreds of millions of attempts per day, across the entire Entra ID estate. The mitigations layered on by Microsoft at the platform level mean most of these attacks fail before they ever generate an alert in your tenant. Three layers of defence sit there by default:

**Smart Lockout.** Entra ID tracks failed sign-in attempts per account and per IP. If too many fail too quickly, the account is briefly locked or the IP is rate-limited. The attacker either slows down (defeats the volume) or fans out across many IPs (defeats Smart Lockout's per-IP throttle, but now their botnet is a more expensive operation).

**Microsoft's banned-password list.** Entra ID has a built-in list of common bad passwords ("Password1", "Welcome2024", "Spring2024!", a few thousand others). If a user tries to set one of those, the password change is rejected. Custom banned-password lists let the MSP add company-specific banned strings ("CustomerCo2024", the company's own name, etc.). Custom banned-password lists require Entra ID P1 (Business Premium or above).

**Behavioural risk scoring** (P2 only). Entra ID Protection — available only at E5 — scores each sign-in for risk. A sign-in from a new country, on an anonymising IP, with a password that arrived from a known-leaked dump, will be flagged as high risk and can be blocked or stepped up to require MFA via Conditional Access.

The honest reality is this: at Business Premium or below, your defence against credential stuffing is **MFA, Smart Lockout, and the banned-password list.** That's it. At E5 you also get risk-based CA. The gap matters because credential stuffing is exactly the class of attack risk-based CA is best at catching.

## How Panoptica365 sees it

Panoptica365 doesn't try to detect credential-stuffing attempts at the *attempt* level — Microsoft has hundreds of detection engines for that, and Defender XDR does cross-tenant correlation we'd be silly to replicate. What Panoptica365 surfaces is the *outcome*: a successful sign-in that looks out of pattern, a foreign-IP sign-in to an account that has only ever signed in from one country, an impossible-travel pattern between two sign-ins separated by minutes and a continent.

These outcome-level signals are the alerts you'll see most often in card 6 (where post-compromise BEC behaviour starts). The credential-stuffing event itself is upstream — what we surface is *the consequence*.

Also worth knowing: Panoptica365's MFA-enforcement check is the most direct defence against this whole class of attack. Every operator-readable alert that says "this user has MFA disabled" is, effectively, "this user is exposed to credential stuffing." Treat MFA-disabled alerts as priority. The 99.9% figure from card 1, lesson 1 (Microsoft's claim that MFA blocks the overwhelming majority of automated account compromise) is *specifically about this attack class*.

## What an attack looks like on the timeline

A typical credential-stuffing run, from the attacker's side, looks like this:

1. **Obtain the list.** Buy a dump on a forum, or pull one off `haveibeenpwned`'s API for free. Modern dumps are denormalised — already in `email:password` format, sorted by domain.
2. **Filter by domain.** Pull every `@customercompany.com` address out of the dump. The attacker now has a target-sized subset.
3. **Test slowly, distributed.** Run the attempts through residential-proxy infrastructure (5–10 attempts per IP per hour, thousands of IPs). This is *specifically* designed to defeat Smart Lockout's per-IP rate limits without tripping per-account limits.
4. **Harvest the successes.** Any account that signs in without MFA is captured. Any account that prompts for MFA is logged for later (the next phase will be either MFA fatigue or AiTM — covered in lessons 2 and 3 of this card).
5. **Persist.** Successful accounts get added to a separate list. Some attackers will use them immediately for BEC (lesson 6); others sell them on the same forums where they bought the original dump.

The whole cycle, end to end, can run in a single weekend. The economics are favourable for the attacker because the inputs cost almost nothing.

## What an attack looks like on the operator's side

You can actually see a credential-stuffing campaign *while it's happening* if you're looking at the right widget. You'll see:

- **A spike in failed sign-ins in Panoptica365's Daily Activity widget on the tenant dashboard.** The donut chart refreshes roughly every 15 minutes and includes failed authentication attempts and Conditional Access blocks. Credential stuffing's signature on the donut is *failures distributed across many users* — distinct from MFA fatigue (lesson 2), where the failures concentrate on one or a few users. The higher-fidelity per-event data is in the Entra sign-in log filtered to failed attempts.
- **A user complaining they were locked out** for no obvious reason. Smart Lockout fired. The attacker's IP got their account temporarily disabled, and the legitimate user is now affected.
- **An MFA-disabled or foreign-IP alert in Panoptica365** for a successful sign-in. This is the *successful* tail of the attack — the one out of every few thousand attempts that landed.

The interesting one for triage is the third. When a foreign-IP successful sign-in alert fires on a user who had MFA disabled, your default assumption should be that the account is *currently compromised*. The right response is: re-enable MFA, force a password reset, revoke all sessions, scan their mailbox for any forwarding rules or recent rule changes (foreshadowing card 1 lesson 2's "phishing → email → identity" chain), and notify the customer. Don't wait for "more evidence" — credential-stuffing successes are confirmed compromises, not maybes.

## Defending the customer

The defensive layer cake for credential stuffing, ordered by impact per unit of effort:

**Enforce MFA universally, with Conditional Access.** This is the single highest-impact defence and the one that disposes of the great majority of these attacks. Microsoft has cited that enabling MFA blocks more than 99.9% of automated account compromise attempts. The 0.1% that gets through is mostly AiTM, MFA fatigue, and consent phishing — the next three lessons. Without MFA, the 99.9% comes back.

**Add a custom banned-password list.** Beyond Microsoft's default list, add the company name, the city, common product names, the year. "CustomerCo2024" is not a strong password and people use it anyway. The Entra ID P1 custom list is one of the easiest wins on a tenant.

**Set Smart Lockout to a sensible threshold.** Microsoft's defaults are reasonable but can be tightened on high-value tenants. The setting is in Entra ID's password protection settings.

**On E5 tenants, enable risk-based Conditional Access policies.** "Block sign-in when user risk is high" and "require password change when user risk is medium" are the two starting policies. They use Microsoft's behavioural scoring (the P2 feature) to catch sign-ins that *look* legitimate but are scored suspicious. Business Premium tenants can't do this — see card 1, lesson 5 for the licensing conversation.

**Push customers toward passwordless / phishing-resistant authentication.** Passkeys, Windows Hello for Business, FIDO2 keys. These don't have a password to steal in the first place. Lesson 3 of this card (AiTM) will explain why phishing-resistant methods matter for *much more* than just credential stuffing.

## What this means for the operator

Two practical takeaways.

**Credential stuffing is a "did you do the basics?" attack.** When it succeeds against a tenant, it almost always reveals one of three failures: MFA wasn't enforced for the user; the user had a banned password that the custom list didn't block; or the tenant has Conditional Access set up loosely enough that the attacker found a path around MFA. The post-incident review of any successful credential-stuffing compromise should ask all three questions.

**The MFA-disabled alert is the most valuable alert in your queue for this attack class.** Panoptica365 surfaces it. It looks unremarkable next to the louder alerts about foreign-IP sign-ins or suspicious mailbox rules, but the MFA-disabled user is the open door the others walk through. Treat it as priority. Resolve it (either by enabling MFA, or by recording an exemption with justification for a service account that legitimately can't have MFA).

## What's next

- **Lesson 2: MFA fatigue — the Uber story.** When the attacker has the password *and* the account has MFA enabled, the next attack is to social-engineer the MFA prompt itself. Push-bombing the user at 2 AM until they tap "Yes."
- **Lesson 3: AiTM phishing — the king of 2026.** The technical bypass of MFA, where the attacker doesn't need either the password (well, they do, but the user types it for them) or the MFA approval (they get it from a real-time proxy).

For now: credential stuffing is the floor. It is the boring, scalable attack the attacker tries first because it's cheap. The defences are well-known and licensable. The reason it still works in 2026 isn't that the attack is clever — it's that MFA isn't universal yet. That's the gap the next two lessons exploit.

---

*Sources for the data points in this lesson — Microsoft Identity Security Group on MFA blocking 99.9% of automated account compromise ([Weinert, August 2019](https://techcommunity.microsoft.com/blog/microsoft-entra-blog/your-pa%24%24word-doesn%E2%80%99t-matter/731984)); Entra ID Smart Lockout reference ([Microsoft Learn — Smart Lockout](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout)); Entra ID Password Protection (banned passwords) ([Microsoft Learn — Eliminate bad passwords](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-password-ban-bad)); breach data set context ([Have I Been Pwned](https://haveibeenpwned.com/)).*
