---
title: "Require MFA for all users — the foundation"
subtitle: "The CA policy that blocks 99.9% of automated account compromise — and why it must be first on every tenant."
icon: "shield-check"
last_updated: 2026-05-29
---

# Require MFA for all users — the foundation

The Microsoft Identity Security team has been saying the same thing for six years: enabling MFA blocks more than 99.9% of automated account compromise attempts. The number has been quoted in every Conditional Access training Microsoft has ever published and in every cyber-insurance underwriting form since 2022.

The flip side of that statistic is the part nobody quotes: in tenants where MFA is *not* universally enforced, the same 99.9% just describes what's happening to all the other tenants. The unprotected user in the unprotected tenant is exactly who the credential-stuffing botnets are looking for.

This is the template that closes that gap.

**Panoptica365 - Require MFA for all users.** Grant: Require MFA. Users: All users. Apps: All cloud apps.

It is the simplest CA policy in the library, the most important, and the one that should be enabled on every Business Premium and above tenant before any other CA work begins.

## What it does

The mechanics are uncomplicated. Every time any user signs in to any cloud app, Microsoft evaluates the policy. If the user has already satisfied MFA in their current session, the sign-in proceeds. If not, Microsoft prompts for MFA before letting the sign-in continue.

The single control is `Require multi-factor authentication`. There are no conditions beyond "all users, all apps." It's the baseline — every sign-in completes MFA before anything else happens.

What the policy does *not* care about:

- The user's location. Whether they're in the office, at home, or in a coffee shop in Lisbon, MFA is required.
- The device. Personal laptops, managed devices, mobile phones — MFA on all of them.
- The app. Outlook, SharePoint, Teams, Power BI, the admin centre — all of them.
- The time of day or the user's role. Everyone, always, every sign-in.

That uniformity is the policy's strength and its weakness. The strength: no edge case is uncovered, no "but my service account doesn't have MFA" gap exists. The weakness: every sign-in, even from a perfectly trustworthy managed device, hits the MFA path. That's the trade-off lesson 5 will revisit.

## What it defeats

Roughly the entire bottom half of card 2's threat catalogue.

**Credential stuffing** (card 2 lesson 1) — the password is correct because the attacker bought it from a breach dump, but they don't have the MFA method, so the sign-in fails. This is exactly the attack the 99.9% statistic was measured against.

**Password spray** — same defence. The attacker tried "Spring2024!" against 50,000 accounts; the few accounts where the password matches still need MFA the attacker doesn't have.

**Stolen credentials from unrelated breaches** — same defence. The user reused their LinkedIn password on M365; the attacker has it; the MFA prompt stops them.

What it doesn't defeat:

- **MFA fatigue** (card 2 lesson 2) — the user is the one approving the prompt; MFA doesn't help when the user is the weak link.
- **AiTM phishing** (card 2 lesson 3) — the attacker proxies the MFA prompt; the user completes MFA on the fake site.
- **OAuth consent phishing** (lesson 4) — no password or MFA is involved; the attack runs through the consent dialog.
- **Device-code abuse** (lesson 5) — the user completes MFA correctly on the real Microsoft page; the attacker gets the token anyway.

In other words: Require MFA for all users defeats the *credential-based* attacks. It does not defeat the *token-based* or *consent-based* attacks. Those need additional layers — compliant-device requirements (lessons 4 and 5), phishing-resistant MFA for high-value users (lesson 6), and the device-code-flow block (lesson 7).

But before any of those layers matter, the foundation must be in place. A tenant without universal MFA is exposed to the simplest, cheapest, most automated attack class. There is no defensible reason to leave that gap open in 2026.

## Who it applies to

The template ships with **Users: All users**. The intent is universal coverage.

In practice, the policy almost always has a handful of exclusions:

- **The break-glass account(s)** — from lesson 1's pre-flight. Excluded by default. Their MFA is enforced through other means (the FIDO2 key stored physically), not through CA.
- **Documented service accounts** that haven't yet been migrated to managed identities — temporarily excluded with a documented expiration. Each service account exclusion is a known security gap and should be on a sunset plan.
- **Specific guest accounts in unusual configurations** — rare. Most B2B guests should have MFA. If a guest account is excluded, document why.

What should *not* be in the exclusion list:

- Executives. ("It's easier this way" is not a security argument.)
- Field workers. (Their MFA is on their phone; that's already in their pocket.)
- "Customer service team" or other generic groups. (If they're using cloud apps, they need MFA.)

If a customer pushes back on universal MFA — "our sales team finds it too annoying" — the right response is to enrol them on the Authenticator app with number matching, or better, on passkeys. The MFA prompt at 8 AM Monday morning is not the friction; the alternative is the friction of explaining a credential-stuffing compromise to that user's entire client list.

## Rollout

This template deploys in Enabled state, per lesson 1, section 3. For most small-business tenants the pre-flight inventory (break-glass excluded, service accounts catalogued, user communication sent) is your dry run; deploy and monitor closely. For complex environments with legacy service principals, deploy via Panoptica365 and then manually flip the policy to Report-only in the Entra portal for a 3–7 day verification window before letting it enforce — lesson 1's section 3 covers the Report-only workflow in detail.

Before deployment, make sure every user has at least one MFA method registered. Microsoft's combined registration page (`mysignins.microsoft.com/security-info`) is the user-facing path. Send the link with instructions a few days before deployment so users aren't surprised by an MFA prompt on a workday morning.

In the first week after enforcement, the Panoptica365 Daily Activity widget will show a spike in successful MFA challenges. That's the policy working — every sign-in is now completing the second factor. MFA-disabled alerts that fired before deployment should be quiet for users who completed enrolment. Users still firing MFA-disabled alerts a week after enforcement are either incomplete enrolments (chase them) or genuine exclusions (verify and document).

Handle the long tail of service accounts and third-party integrations as the alerts surface in the first week. Document each exclusion with a justification and a sunset date in Panoptica365's exemption system.

## What to monitor after enforcement

Three things to watch:

**MFA challenge failures.** A sudden burst of failed MFA challenges on one user is the MFA fatigue pattern from card 2 lesson 2. The Daily Activity donut surfaces this near-real-time. The triage approach is unchanged: foreign IP + failed MFA bursts + eventual success = treat as compromise.

**Sign-ins that complete MFA via SMS or voice.** These methods are weaker than push, far weaker than passkeys. The Authentication Methods report in the Entra portal shows the breakdown. Customers with too much SMS reliance are candidates for the lesson 6 admin-hardening upgrade (phishing-resistant MFA for high-value users).

**Drift on the policy itself.** Panoptica365's CA drift detector flags if the policy gets disabled, the user list narrows, or the exclusion list grows. An exclusion list that's growing without your knowledge is somebody else turning off MFA for a user — investigate.

## The overlap with lesson 5

You'll notice when you read lesson 5 that the **Require compliant or hybrid Azure AD joined device or MFA for all users** template offers an alternative path: managed devices skip MFA, unmanaged devices get MFA. Both templates exist in the library; they're not meant to be enabled together as a coherent strategy.

If you enable both: the strictest combination wins. The lesson 2 policy demands MFA unconditionally, the lesson 5 policy says "MFA is one of three acceptable proofs." When both apply, MFA is required because lesson 2 doesn't accept the device-trust paths. Lesson 5 becomes redundant.

The right way to think about it:

- **Enable Require MFA for all users (this lesson)** as the default policy when the tenant doesn't yet have reliable Intune compliance, when you're early in the rollout, or when you want simple "always MFA" semantics.
- **Enable Require compliant OR hybrid OR MFA (lesson 5)** as the upgrade when Intune compliance is in place and reliable, the customer wants better UX for users on managed devices, and you trust the compliance signal.

Lesson 5 has the full treatment of the strategy choice. For now: pick one. Don't run both expecting the OR-paths to apply — they won't.

## What this means for the operator

Three takeaways.

**This is the policy you deploy first.** Before any other CA work, before any Intune templates, before any of the more sophisticated controls in later lessons. A tenant without universal MFA is exposed to the simplest possible attack; closing that gap is the highest-leverage thing you can do for a new customer.

**The 99.9% statistic earns its keep here.** When a customer pushes back on the friction of universal MFA, that statistic is the right answer. It's not a slogan; it's a measured outcome from Microsoft's own telemetry. Cite it. Use it.

**Document every exclusion.** Every service account, every special case, every "this user can't have MFA because…" entry on the exclusion list is a hole in the perimeter. Treat each one as a known issue with a sunset date. Panoptica365's exemption system makes this concrete — use it.

## What's next

- **Lesson 3: Block legacy authentication.** The companion policy to this one. Without legacy auth blocking, the attacker who has the user's password can simply use a legacy protocol that doesn't support MFA and bypass this entire policy. Lessons 2 and 3 are a paired deployment.
- **Lesson 5: Compliant device OR hybrid OR MFA.** The upgrade path for tenants with Intune in place — better UX, same security floor.

For now: this is the policy you cannot ship without. Get it deployed on every customer tenant. Document exclusions. Move on to lesson 3.

---

*Sources for the data points in this lesson — Microsoft Identity Security Group on MFA blocking 99.9% of automated account compromise ([Weinert, August 2019](https://techcommunity.microsoft.com/blog/microsoft-entra-blog/your-pa%24%24word-doesn%E2%80%99t-matter/731984)); Microsoft Learn on Conditional Access policy structure ([Microsoft Learn — Conditional Access policies](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policies)); combined registration page reference ([Microsoft Learn — Combined registration](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-registration-mfa-sspr-combined)).*
