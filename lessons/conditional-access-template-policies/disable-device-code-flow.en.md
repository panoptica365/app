---
title: "Disable device code flow — the Storm-2372 defence"
subtitle: "How Storm-2372 abuses device-code flow to bypass MFA, and the one CA policy that closes the attack surface."
icon: "smartphone"
last_updated: 2026-05-29
---

# Disable device code flow — the Storm-2372 defence

Card 2 lesson 5 walked through what device-code abuse is, why it bypasses MFA, and how Storm-2372 — a Russia-aligned threat actor — has been using it at scale against governments, NGOs, IT services and other targets since August 2024. The defence in that lesson was a single CA policy: block the device-code authentication flow for users who don't need it.

This is that policy.

**Panoptica365 - Disable Device Code Flow.** Description: *Prevents device code flow exploit.* Grant: None (block). Users: All users. Apps: All cloud apps.

It is one of the cheapest, highest-leverage CA policies you can deploy on a customer tenant. Most tenants have zero legitimate need for the device-code flow. Blocking it costs nothing in those tenants and closes the entire Storm-2372 attack surface.

This lesson is the operational detail — what the policy does, when to deploy it, what to watch for, when the rare exceptions apply.

## What it does

The policy uses Conditional Access's **authentication flows** condition — a relatively recent CA condition (preview through 2024, generally available in 2025) that lets you target sign-ins by *how* they authenticated. One of the toggles inside that condition is "Device code flow."

The policy is configured:

- **Authentication flow condition: Device code flow.**
- **Grant: Block.**
- **Users: All users.**
- **Apps: All cloud apps.**

Any sign-in attempt that uses the device-code flow is rejected outright. The user code that an attacker sent the victim via WhatsApp / Teams / Signal cannot be redeemed. The Storm-2372 playbook fails at the very first step.

The mechanic from card 2 lesson 5 is worth re-stating in one sentence: device-code phishing works because the user completes MFA correctly on Microsoft's real page, but the device receiving the resulting token belongs to the attacker. Blocking the device-code flow at the policy layer means the token is never issued, regardless of whether the user completed MFA.

## Why "All users" is the right default

Most CA policies are deployed with thoughtful scoping — specific user groups, specific apps. This one defaults to "All users / All cloud apps" and that's correct.

The reason: the device-code flow is a *legitimate Microsoft authentication path*, but it's used by a very narrow set of legitimate clients. Specifically:

- Printers and IoT devices doing scan-to-email or similar — but these usually use service accounts, not user accounts, and the service account often has its own dedicated CA policy.
- Microsoft Graph PowerShell or Microsoft 365 CLI when run on a machine that doesn't have a browser available — narrow use case, usually a developer or admin doing automation work.
- Old Microsoft sample apps and tutorials — rare in 2026, mostly retired.

For the vast majority of users in the vast majority of tenants, the device-code flow is not legitimately used. The few exceptions (specific service accounts, specific developer scenarios) are excluded by name rather than by carving out user populations broadly.

A tenant with zero documented device-code use cases should block the flow for all users. A tenant with one or two documented use cases should block for all users *except* the specific service accounts that need it. There's no scenario where "device code flow open for everyone" is the right setting in 2026.

## What can break — and how to handle it

The most common breakage when this policy is enabled:

**Multi-tenant PowerShell automation.** An MSP that uses Microsoft Graph PowerShell to manage multiple customer tenants often runs scripts that authenticate via device code. The script outputs a code, the operator enters it in a browser, the script then operates on the customer's tenant. If the customer's tenant has the device-code block enabled, the script fails.

Fix: use service-principal authentication (client secret or certificate) instead of device-code. Modern Graph PowerShell supports it. The script changes from "interactive device-code login" to "non-interactive service-principal login," which is more secure anyway because there's no human-in-the-loop step where social engineering can hijack the flow.

**Specific Microsoft sample tutorials.** Microsoft documentation sometimes uses device-code as the example authentication flow for newcomers. Following those tutorials against a tenant with this policy enabled will fail. The fix is usually to use the interactive sign-in flow instead, which works through a normal browser.

**Old printers and IoT devices.** Some legacy multifunction devices use device-code for scan-to-email setup. Newer devices have moved to OAuth 2.0 SMTP with stored credentials. If you have an old printer that still uses device-code, you have a choice: exclude the printer's service account from this policy (with a documented justification and a sunset date for printer replacement), or replace the printer with a modern model.

**Customer's home-grown tools.** Occasionally a customer has a custom-built tool that authenticates via device-code. Same answer as for printers: exclude the specific account with documentation, or migrate the tool to service-principal authentication.

The pattern in every case: the exception is *one specific account on one specific use case*. Broad exclusions like "exclude the IT department" are the wrong move. The IT department doesn't need device-code as a class.

## Rollout

Shortest rollout in the card because the legitimate-use surface is small. The pre-flight inventory is the dry run.

Pre-flight inventory: check the Entra sign-in log for the past 30 days, filtered to `authenticationProtocol == "deviceCode"`. List every account that has successfully used device-code. For most customers this list will be very short or empty.

For each pre-flight match:

- Legitimate use case (service account, documented automation) → add to the policy's exclusion list with a sunset date *before* deployment.
- Unexpected user → potential indicator of compromise (an attacker may already be device-code-phishing this user). Investigate immediately, *before* deploying this policy.

Once the pre-flight is complete, deploy. The template enables in Enabled state — typically with zero impact on legitimate users because almost nobody on a small-business tenant uses device-code legitimately. Monitor the first 48 hours for any unexpected user blocked by the policy. Either you missed something in the pre-flight (rare but possible), or an attacker has just been thwarted (the policy is working).

For larger or more complex tenants with multiple documented device-code use cases, the manual Report-only step in the Entra portal can be used as extra caution — but for most tenants, the pre-flight inventory is sufficient and the deploy-hot approach is appropriate.

## What to monitor after enforcement

The Daily Activity widget will show CA blocks on this policy. In a healthy tenant, the volume should be:

- **Near zero** in steady state. Real users on real devices don't use device-code, so they don't trigger the policy.
- **Occasional spikes** when an attacker probes — typically Storm-2372-style campaigns that try to start a device-code flow on the tenant. Each spike is a *successful defence* — the policy is doing its job.

What you specifically want to see if Storm-2372 ever targets a customer:

1. **A burst of failed sign-ins** with `authenticationProtocol == "deviceCode"` — the attacker's automated device-code initiation hitting the policy.
2. **No successful device-code sign-ins** — the policy is blocking the attempted abuse before it can complete.
3. **No new device registrations** in the audit log following the failed attempts.

The third bullet matters specifically because of Storm-2372's February 2025 evolution: the attacker tries to register their own device in Entra ID using the device-code-acquired token. If the device-code flow was blocked, no token was issued, and no device registration follows. The whole attack chain stops at the first step.

If you ever see successful device-code sign-ins in a tenant where this policy is supposed to be enabled, that's an alert worth investigating immediately — either the policy was disabled (drift) or an exclusion is too broad (misconfiguration). Both are urgent.

## What Panoptica365 sees

Two main signal categories:

**Suspicious device-code sign-in attempts (failed or successful).** Panoptica365's UAL ingestion pipeline includes evaluators that look for device-code activity. When the policy is enabled and working, you should see failed attempts (the policy blocked them) and very few or no successful attempts. A successful device-code sign-in to an unexpected account is worth investigating.

**New device registered.** When an attacker successfully completes Storm-2372's evolved attack (the February 2025 Microsoft Authentication Broker variant), the next step is to register their machine as a device in the tenant. Panoptica365 alerts on new device registration events. Cross-reference with sign-in activity — was there a recent device-code sign-in for this user before the device registered? That's the attack chain.

The Daily Activity donut also surfaces CA blocks in near-real-time, including blocks on this policy.

## The customer conversation

When you propose enabling this policy on a customer tenant, the typical customer question is "what does this break?" The honest answer is "almost nothing, because almost nothing legitimately uses device-code in your environment." The pre-flight inventory will tell you for sure — and if there are one or two legitimate use cases, you exclude those accounts and proceed.

The pitch:

- The Storm-2372 threat is real, documented, ongoing.
- Microsoft itself has recommended blocking device-code for tenants without documented use cases since February 2025.
- The policy enables in Report-only first, so you can verify nothing breaks before enforcing.
- The cost is essentially zero (no friction for normal users; specific exclusions for any legitimate automation).

For tenants in target sectors (government, NGOs, IT services, defence, telecoms, healthcare, higher education, energy — the Storm-2372 target list), this policy is especially recommended. For other sectors, it's still recommended; the actor's targeting can change, and the policy is cheap enough that defence-in-depth applies.

## What this means for the operator

Three takeaways.

**Add this to the new-customer onboarding checklist.** Of all the CA templates in card 3, this one has the highest impact-to-effort ratio for most tenants. Three-day rollout, near-zero user friction, complete defence against a sophisticated identified threat.

**Watch the sign-in log for legitimate device-code use as a baseline.** If you find a tenant where device-code is being used by something you didn't expect, that's interesting — it might be legitimate (a forgotten script) or it might be an existing partial compromise. Either way, investigate before deploying the policy.

**This policy doesn't replace the others.** It's narrowly scoped — only the device-code flow. The rest of the CA library (MFA enforcement, geo-restrictions, admin hardening) is still needed. This policy closes one specific attack vector that the broader policies don't address.

## What's next

- **Lesson 8: Importing your own CA templates.** How to take a custom CA policy from one tenant and turn it into a Panoptica365 template that deploys across the MSP's customer base. The named-location generalisation that makes templates portable.
- **Lesson 9: Operating CA at scale.** The meta closer on drift, exclusions, and lifecycle.

For now: deploy this policy on every customer tenant that doesn't have a documented device-code requirement. The customer's risk against the Storm-2372 threat goes from "exposed" to "covered" with three days of work and near-zero friction. There aren't many other CA policies with that ROI.

---

*Sources for the data points in this lesson — Microsoft Security Blog on Storm-2372 device code phishing campaign ([Microsoft Security Blog — Storm-2372 conducts device code phishing campaign, February 2025](https://www.microsoft.com/en-us/security/blog/2025/02/13/storm-2372-conducts-device-code-phishing-campaign/)); Conditional Access authentication flows condition ([Microsoft Learn — Conditional Access: Authentication flows](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-cloud-apps#authentication-flows)); OAuth 2.0 device authorisation grant flow technical reference ([Microsoft Learn — OAuth 2.0 device code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)).*
