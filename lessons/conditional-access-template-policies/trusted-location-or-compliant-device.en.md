---
title: "Trusted location OR compliant device — the smart geo-policy"
subtitle: "Replace the brittle country-block with a geo-policy that grants access based on device trust, not location."
icon: "map-pin"
last_updated: 2026-05-29
---

# Trusted location OR compliant device — the smart geo-policy

An MSP we recently audited had a Conditional Access policy on a customer's tenant that read, plainly, "block sign-in from outside Canada." It had been deployed two years ago. The exclusion list had grown to thirty-eight entries.

Spain (for the controller's vacation in 2023).
The United States (for the salesman who travels to trade shows).
France (for the executive's family visit, set up a year ago).
Mexico (for the accountant's winter trip).
Italy (still active from two summers ago, when the CFO visited family for three weeks).

Most of those exclusions were obsolete. The salesman hadn't been to a US trade show in eight months but the US exception was still in force. The Spain exclusion was for a contractor who no longer worked there. The Italy exclusion existed because nobody remembered to remove it.

Every exclusion was a hole in the geo-policy. Together, they amounted to "the geo-policy is on, but the entire western hemisphere plus most of Europe is excluded for various users for unknown durations." Whatever security the policy was supposed to provide had been quietly traded away one helpdesk ticket at a time.

This lesson is the policy that doesn't accumulate that kind of debt.

**Panoptica365 - Only allow access from Canada.** Description: *Logins only from Canada or from Compliant devices.* Grant: None (block). Users: All users. Apps: All cloud apps. Conditions: Locations = 1 location (the named "Canada" location).

The lesson title says "Canada" because that's the default; in practice this is the template for *any* trusted-location-plus-compliant-device pattern. We'll cover the geographic customisation later in the lesson.

## The OR pattern is the entire point

Most MSP-security tools ship a "block outside trusted location" template that looks straightforward: define a named location, and block sign-ins from anywhere else. Simple, defensible, fits the security model.

It also creates the exception-sprawl problem. Every traveller is an exception. Every contractor is an exception. Every executive's vacation is an exception. The exceptions accumulate, never get removed, and the policy quietly becomes a paper-thin defence.

The Panoptica365 template doesn't use that pattern. It uses **(location-trusted) OR (device-compliant)**. The grant control is configured so that a sign-in satisfies the policy if *either* condition is true:

- The sign-in is from a trusted named location (the office IPs, the country range, whatever you've defined), OR
- The user's device is marked as compliant in Intune.

Both conditions prove the same underlying intent — the user has demonstrated they're operating from a trustworthy context — and either is sufficient. Failing both means the policy denies the sign-in.

The consequence: travellers on managed laptops don't trip the policy, because their device satisfies the OR. Travellers on personal devices *do* trip the policy. The distinction the policy enforces is no longer "Canadian or not"; it's "trustworthy context or not." That's the right distinction.

## What this means in practice

A salesperson on a Tuesday trip to Chicago:

- Naive geo-policy: blocked. Help desk call. Exception added for the US. Exception forgotten in six weeks.
- Panoptica365 template: not blocked if their managed laptop is enrolled in Intune and compliant. No exception needed. No help desk call.

A user on their personal phone trying to sign in to Outlook while visiting family in Paris:

- Naive geo-policy: blocked. Help desk call. Exception added for France. Exception forgotten.
- Panoptica365 template: blocked (because personal phone is not compliant). User can fall back to the managed laptop, or wait until they're back home. *No exception added; no security debt accumulated.*

A new attacker trying to sign in to a user's account from Eastern Europe:

- Naive geo-policy: blocked. Successfully.
- Panoptica365 template: blocked (attacker's device is not compliant; attacker's location is not trusted). Successfully.

The policy enforces the same security boundary the customer wanted — sign-ins are restricted to trustworthy contexts — without the operations debt.

## What the template assumes

For the OR-condition pattern to work, **Intune compliance must be in place and reliable.** If the customer doesn't have Intune (Business Standard or below), or has Intune but hasn't enrolled devices or configured compliance policies, then the "device-compliant" path of the OR is effectively empty. Every sign-in falls through to the location check, the policy behaves like a naive geo-block, and the exception sprawl returns.

So the prerequisites:

- **Intune Plan 1 or above** (Business Premium baseline).
- **Compliance policies configured** for the device platforms the customer uses (Windows, iOS, Android, macOS).
- **Devices enrolled** — a meaningful fraction of the user base on managed devices.
- **Compliance evaluation working** — devices reporting compliant when they should be.

Card 4 (Intune template settings) covers the compliance side in detail. For the CA template here, the operator needs to verify that compliance is reliable before flipping the policy from Report-only to On. The pre-flight (lesson 1) covers this.

## The Canada default is just a default — customise per customer

The shipped template names "Canada" because Panoptica365 was originally built in a Canadian MSP context. For non-Canadian customers, the named location needs to be customised:

- An MSP serving customers in Mexico defines a "Mexico" named location with the relevant IP ranges and country code, and imports a customised version of this template with that location selected.
- A French MSP defines "France" or "EU" depending on travel patterns.
- A multi-region MSP with US and Canadian customers may have separate templates per region.

The mechanics of customising are covered in lesson 8 (Importing your own CA templates). For now: the template *concept* is portable. The location is parameterised. The OR-condition pattern stays the same regardless of geography.

## What the operator decides at deployment

When deploying this template, the operator answers four questions:

**1. What's the trusted location?**

For most customers, it's their country, defined as the country code (Microsoft maintains the country-to-IP mappings). For customers with specific office locations only, it's the office IP ranges as separate named locations. For multi-region customers, multiple named locations.

The trusted location should be the place where the *vast majority* of legitimate sign-ins originate. If your customer does business in multiple countries, define each one. If they have remote workers who genuinely work from anywhere, the location-based path is less useful and you lean harder on the compliant-device path.

**2. Who's covered?**

Default: all users. Same logic as Require MFA for all users (lesson 2). Real users are covered; service accounts are excluded by name with documented justification.

**3. What are the apps?**

Default: all cloud apps. The policy applies to every sign-in regardless of app. There's no good reason to scope it narrower for most customers.

**4. Is Intune compliance actually working?**

If the answer is "yes," deploy the template as-shipped.

If the answer is "no, but it will be soon," deploy with Intune compliance still being rolled out and accept that until compliance is in place, the OR-path is empty and the policy behaves as a strict geo-block. Set a calendar reminder to verify after the Intune rollout.

If the answer is "no, and it won't be soon" (because the customer hasn't bought Intune licensing), then this template is the wrong choice for this customer. Use Require MFA for all users (lesson 2) and accept that geographic context isn't enforced.

## Rollout

This template deploys in Enabled state. For small-business tenants with no executives who travel internationally and a reliable Intune compliance posture, deploy and monitor closely — the pre-flight inventory should have caught the typical exceptions.

For tenants with frequent international travellers or where Intune compliance is still being rolled out, the manual Report-only step in the Entra portal is recommended. The reason: travel patterns hide in monthly and quarterly cycles. A 3-day window misses the executive who visits family every six weeks. Budget a 14-day Report-only window if you take that route.

During the verification window (whether Report-only or live monitoring after deployment), look for blocks and classify each one:

- Trip outside trusted location on a compliant device → policy would *not* have blocked them (good — the OR-pattern is doing its job).
- Trip outside trusted location on a non-compliant device → blocked. Was this a legitimate trip? If yes, the user needs to be on a managed device, or this user is an exclusion candidate. If the trip pattern is rare, plan to handle via exemption with a sunset date; if it's frequent, this user needs an Intune-enrolled device.
- Sign-in from outside trusted location, no good explanation → potential attacker. Investigate.

Fix exclusions for legitimate non-managed-device travellers (with sunset dates in Panoptica365). Address device compliance issues for users who should be on managed devices but aren't.

## What to monitor after enforcement

**Sign-ins blocked by this policy.** Should be rare in steady state. Each block is an opportunity to ask: was this a real attack, or a legitimate user without a compliant device? The Daily Activity donut surfaces CA blocks near-real-time.

**The exclusion list.** Should be stable. New entries appearing without your knowledge mean somebody — another admin, a help-desk technician, a delegated GDAP user — is adding exceptions. Investigate. The Panoptica365 audit trail surfaces who, when, and why for every policy mutation.

**Trusted-location IP changes.** If the customer's office IP changes (ISP migration, branch office opens), the named-location definition needs updating. Until it is, legitimate sign-ins from the new IP will be treated as untrusted-location. The first complaint after an office move is usually this.

## What Panoptica365 sees

Three signal categories:

**Foreign-IP successful sign-ins** — when the policy's location-trusted path failed but the compliant-device path succeeded. Not a problem (it's the policy working), but it's a signal worth knowing — the user is travelling.

**Foreign-IP blocked sign-ins** — Daily Activity donut shows the CA-block count. Steady-state low; a sudden spike suggests credential-stuffing attempt against this customer.

**Drift on the named-location definition.** If the named-location IP list or country list changes unexpectedly, Panoptica365 alerts. This is a quiet way to attack a policy — broaden the trusted location until the attacker's IP fits inside it.

## The retired pattern, named explicitly

Many MSPs (us included, in earlier iterations of this template) shipped a naive geo-block template. We don't anymore, for the reasons above. The audit anecdote from the opening of this lesson is real, recent, and not unusual. If you're inheriting a customer who has the older pattern in place — a strict geo-block with a long exclusion list — the right move is:

1. Inventory the existing exclusions.
2. Identify which were never necessary in the first place (long-departed users, completed projects).
3. For the remaining legitimate ones, verify Intune coverage and migrate those users to compliant devices.
4. Replace the naive geo-block with this template.
5. Retire the exclusion list — it should be empty after the migration, except for documented service accounts.

This is one of the higher-leverage cleanups you can do on an inherited tenant. The before/after security posture is dramatically different even though the *intent* of both policies is the same.

## What this means for the operator

Three takeaways.

**The OR-condition is the lesson.** Whenever you see a policy that has a single binary check (location only, device only, MFA only), ask whether an OR-condition would serve the same security intent with less operations burden. Often it will. This lesson's template is the canonical example; the same pattern appears in lesson 5.

**Don't add geographic exclusions to this template.** If a user is genuinely travelling and they're on a non-compliant device, the right answer is "your device needs to be compliant," not "let me add Italy to the exception list." The whole point of the OR-condition is to make exclusions unnecessary. Adding exclusions undoes the design.

**Verify Intune compliance is real before deploying.** If compliance isn't working, this template degrades to a naive geo-block. Lesson 1's pre-flight covers the Intune verification; don't skip it.

## What's next

- **Lesson 5: Compliant device OR hybrid OR MFA.** The broader application of the OR-condition pattern — three trust-signals as alternative paths. Same design principle, larger scope.
- **Lesson 8: Importing your own CA templates.** How an MSP outside Canada customises this template's named location for their own geography.

For now: this is the template that replaces the exception-sprawl pattern. Inherit a tenant with a naive geo-block, migrate it to this template, and the customer's CA posture quietly becomes more secure *and* less work to operate. Both things matter.

---

*Sources for the data points in this lesson — Microsoft Learn on named locations in Conditional Access ([Microsoft Learn — Conditional Access: Locations](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-assignment-network)); Conditional Access OR-grant semantics ([Microsoft Learn — Conditional Access: Grant](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-grant)); Intune device compliance signal in Conditional Access ([Microsoft Learn — Device compliance](https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started)).*
