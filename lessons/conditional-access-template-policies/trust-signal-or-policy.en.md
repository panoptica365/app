---
title: "Compliant OR hybrid OR MFA — the trust-signal OR policy"
subtitle: "The Intune-aware successor to Require MFA: grant access when a device is managed, hybrid-joined, or MFA-satisfied."
icon: "git-branch"
last_updated: 2026-05-29
---

# Compliant OR hybrid OR MFA — the trust-signal OR policy

Lesson 2 covered the Require MFA for all users policy: simple, foundational, always-MFA-no-matter-what. This lesson is its successor — the more sophisticated version for tenants that have Intune working and want to give users on managed devices a smoother experience without giving up the security floor.

**Panoptica365 - Require compliant or hybrid Azure AD joined device or MFA for all users.** Description: *Check several conditions to allow connections.* Grant: Require MFA, Require compliant device, Require Hybrid Azure AD joined (OR). Users: All users. Apps: All cloud apps.

This template uses the same OR-condition pattern lesson 4 introduced — multiple paths to satisfy the same intent. Lesson 4's policy combined location-trust with device-trust. This lesson's policy combines three different ways of proving the user's posture is trustworthy: managed device, hybrid-joined device, or MFA.

Pick any one, the sign-in proceeds. Pick none, the sign-in is blocked.

## The three paths

**Path 1: Compliant device.** The device the user is signing in from is enrolled in Intune and currently reports as compliant. Compliance typically means: encryption on, OS patched within an acceptable window, AV active, no jailbreak, the customer's specific policy is met. If the device clears that bar, the sign-in proceeds — *no MFA prompt needed*. The device has proven the user's posture is trustworthy.

**Path 2: Hybrid Azure AD joined device.** The device is a corporate-managed Windows machine joined to both the on-premises Active Directory and Entra ID. Hybrid-joined devices are typically corporate-issued workstations in environments where the customer maintains a domain controller. Like compliant devices, hybrid-joined devices have proven they're managed and trustworthy. Sign-in proceeds without MFA.

**Path 3: MFA.** The user completes a multi-factor authentication challenge. This is the fallback path for users on personal devices, unmanaged devices, or devices not yet enrolled. If they can prove identity through MFA, they get in.

Any one of the three is sufficient. The grant control is configured with "Require one of the selected controls" rather than "Require all selected controls" — that's the structural difference between this template and a naive "require everything" policy.

## What this is *actually* doing

Read the policy intent through the lens of card 1: *who, what, where, when, weird?* This policy is answering one question — "is this sign-in trustworthy?" — and accepting three different proofs:

- **The device proves it** (compliant or hybrid-joined). Microsoft and Intune have already vetted the device; trust transfers to the sign-in.
- **The user proves it** (MFA). The human in front of the keyboard has demonstrated they're the legitimate user.

If neither the device nor the user proves it, the sign-in is denied. There's no fourth path. There's no "trust because it's Wednesday" exception.

The policy's strength is in the *combined* effect: on managed devices, users have a frictionless sign-in experience (no MFA prompt every session); on unmanaged devices, the MFA path catches them. The customer gets the security floor of always-trusted-or-MFA without the always-MFA friction.

## When to use this template instead of "Require MFA for all users"

Lesson 2's template (Require MFA for all users) and this lesson's template are the two main strategic choices for a tenant's baseline CA policy. They're alternatives, not complements. The choice depends on the customer's Intune posture and friction tolerance.

**Use Require MFA for all users (lesson 2) when:**

- The customer doesn't have Intune yet (Business Standard or below — though those customers shouldn't be there in the first place per card 1 lesson 5).
- The customer has Intune but device coverage is patchy — some users on managed laptops, others on BYO.
- You're in the middle of rolling out Intune and compliance is still unreliable.
- The customer's leadership wants the simplest possible "MFA on every sign-in" posture for compliance reasons.

**Use this lesson's template (Compliant OR hybrid OR MFA) when:**

- Intune is rolled out and compliance is reliable.
- The majority of users are on managed devices.
- You want better UX for those users without compromising the security of users on unmanaged devices.
- The customer is comfortable with the device-trust signal carrying weight (rather than requiring MFA on every sign-in).

In practice, the second template fits most well-managed Business Premium tenants once Intune is in place. The first template is the safe default during the Intune rollout window or for tenants without an Intune story.

## What happens if both are enabled simultaneously

This is the question that often comes up — and the answer affects how an operator thinks about migrating between strategies.

Conditional Access policies *stack via logical AND across policies*. A sign-in must satisfy every applicable policy. Within a single policy, the grants are combined via the rules of that policy (OR for "any of," AND for "all of").

So if both Require MFA for all users (lesson 2) and Compliant OR hybrid OR MFA (this lesson) are enabled:

- Lesson 2's policy says: *must complete MFA*.
- This lesson's policy says: *must have compliant device, OR hybrid-joined device, OR complete MFA*.
- Combined: *must satisfy both policies*.

The lesson 2 policy's MFA requirement is unconditional. The lesson 5 policy's OR-paths include MFA. So the only way to satisfy *both* is to complete MFA. The compliant-device and hybrid-joined paths of lesson 5 become irrelevant — even on a perfectly compliant device, the user still has to do MFA because lesson 2 demands it.

**Net effect of both enabled: same as enabling lesson 2 alone.** The "OR" parts of this lesson's template are suppressed by the unconditional MFA requirement of lesson 2.

This is *not* a useful configuration. It's not "defence in depth" — it's redundancy with the strictness of the strictest policy. The compliant-device path that the lesson 5 template was designed to enable is unreachable.

The right configurations:

- **Enable only lesson 2** if you want strict-always-MFA semantics.
- **Enable only lesson 5** if you want smart-OR-based-trust semantics.
- **Do not enable both** and expect the OR-paths to apply.

The migration path between strategies:

1. Start with lesson 2's policy enabled (always-MFA). Most tenants land here first because Intune isn't ready yet.
2. Roll out Intune compliance. Get the device-side ready.
3. When compliance is reliable, deploy lesson 5's policy in Report-only mode.
4. Verify that sign-ins from compliant devices match the policy and would be allowed without MFA.
5. Flip lesson 5 to On.
6. *Disable lesson 2* once lesson 5 is enforcing. (Or keep lesson 2 in Report-only as a documentation reference; that's fine, just don't have both enforcing.)
7. The user experience changes: managed-device users no longer see an MFA prompt every session.

The decision point is between steps 5 and 6. If the customer is nervous about the change, you can keep both policies enforcing for a brief overlap period — users will continue to see MFA prompts even on compliant devices — and then disable lesson 2. The pre-flight (lesson 1) should have already verified that compliance is reliable; the overlap is just a confidence-building measure.

## What to watch for during the migration

**Compliance reporting reliability.** The whole strategy depends on devices accurately reporting their state. If a device is genuinely compliant but Intune reports it as non-compliant (network issues, sync lag, stale state), the user gets an MFA prompt where they shouldn't. Inverse is worse: if a device is non-compliant but Intune reports it as compliant, the sign-in skips MFA when it shouldn't.

Run periodic device-reconciliation checks. If a device shows compliant in Intune but is failing some compliance check at the OS level, the gap matters.

**Lazy compliance evaluation.** Intune doesn't continuously re-evaluate every device. There's a check-in cadence. A device that goes non-compliant (user disables BitLocker, falls behind on patches) may still report compliant for some hours after the change. CA reads the current state at sign-in time, so there can be a short window where the device-trust path of this policy is "compliant" when it shouldn't be.

Don't worry about minute-level lag — it's the hour-level lag that matters. Set device-compliance check-in intervals appropriately in Intune.

**Hybrid-joined-device drift.** If the customer has a Hybrid AD environment, devices can fall out of hybrid-joined status without anyone noticing (Azure AD Connect sync issues, replication lag, decommissioned domain controllers). Devices that are no longer hybrid-joined silently lose the hybrid-joined trust path. Don't notice this until the user is on a personal network and the sign-in fails.

Monitor your Hybrid AD sync health regularly; Panoptica365 doesn't directly surface this signal but the underlying Entra sync health is visible in the Microsoft admin centres.

## Rollout

Migrating from lesson 2's policy to this one is the typical migration path. The work is substantial enough that **the manual Report-only step in the Entra portal is recommended for this migration regardless of tenant size**. The reason: this isn't a single new policy; it's a strategy change. Mistakes are louder.

Pre-flight verification (per lesson 1) confirms Intune compliance is reliable on a substantial fraction of the user base, hybrid-joined devices are sync-healthy if applicable.

Then:

1. **Day 0** — deploy this template via Panoptica365 (creates the policy in Enabled state). Immediately flip the policy to Report-only in the Entra portal. Keep the lesson 2 template enforcing during this window.
2. **Days 1–7** — pull the sign-in log filtered to this policy's Report-only result. For each sign-in:
   - Did the compliant-device or hybrid-joined-device path succeed? (User is on a managed device.) Good — the OR-pattern is working as designed.
   - Did only the MFA path succeed? (User completed MFA, no other path was available.) This user is either on a personal device or on a managed device where compliance is misreporting. Investigate.
   - Did the sign-in fail all three paths? (Blocked.) This is a user who couldn't authenticate even with MFA — likely a configuration issue. Investigate.
3. **Days 7–14** — fix any compliance misreporting issues surfaced during Report-only.
4. **Day 14** — flip this template back to Enabled in the Entra portal.
5. **Day 14 (same day)** — disable the lesson 2 template in Panoptica365 (or flip it to Report-only as a documentation reference, but don't keep it enforcing alongside this one).
6. **Day 14 onward** — monitor user behaviour. Users on managed devices will notice the smoother experience; users on personal devices won't notice any change (they were getting MFA before and they get MFA now).

Total window: two weeks. The friction cost is justified — this strategy change rewards careful verification.

## What this means for the operator

Three takeaways.

**This is the upgrade target for tenants with reliable Intune.** Move customers here as soon as their Intune posture is good. Better UX for users on managed devices, same security floor for users on unmanaged ones, less friction overall.

**Don't run lesson 2 and this lesson in parallel.** The OR-paths get suppressed. You're effectively running lesson 2 with extra audit-log noise. Pick one strategy per tenant.

**The strategy choice tracks the Intune rollout.** A new customer typically starts on lesson 2 (always-MFA) because Intune isn't yet rolled out. As Intune coverage grows, the device-trust signal becomes reliable, and the customer is ready to graduate to this lesson's template. The transition is itself a milestone in the customer's security maturity.

## What's next

- **Lesson 6: Hardening admin access.** Four admin-specific templates in one lesson. The combination of MFA enforcement, MFA-for-portals, and session controls.
- **Lesson 7: Disable device code flow.** The Storm-2372 defence.

For now: if a customer has Intune working, this is the template they should be on. The migration from lesson 2 is a two-week exercise that pays for itself in user UX immediately and in operator hours saved over time (fewer "the MFA prompt is so annoying" complaints from senior users).

---

*Sources for the data points in this lesson — Microsoft Learn on Conditional Access grant controls and OR-vs-AND semantics ([Microsoft Learn — Conditional Access: Grant](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-grant)); Intune device compliance and signal flow into CA ([Microsoft Learn — Device compliance for Conditional Access](https://learn.microsoft.com/en-us/mem/intune/protect/conditional-access)); Hybrid Azure AD join overview ([Microsoft Learn — Hybrid Azure AD join](https://learn.microsoft.com/en-us/entra/identity/devices/concept-hybrid-join)).*
