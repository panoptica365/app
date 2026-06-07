---
title: "Defender, Intune, Conditional Access — how they actually fit together"
subtitle: "The compliance loop in five steps: how Intune, Defender, and Conditional Access hand off through Entra to make every sign-in decision."
icon: "puzzle"
last_updated: 2026-05-29
---

# Defender, Intune, Conditional Access — how they actually fit together

You get a ticket at 9:14 AM. *"Karen can't sign in to Outlook from her laptop. She just changed her password last week. Please help."*

You open three browser tabs. The first is the Entra admin portal — you check Karen's sign-in logs. The second is the Intune portal — you check her device's compliance state. The third is the Defender XDR portal — you look for alerts on her account.

Three portals. Three different teams' worth of UI. Three different mental models. And the answer to "why can't Karen sign in" lives somewhere in all three.

This lesson is why those three portals exist, what each one's actual job is, and how to find the answer to Karen's ticket without checking your watch every three minutes.

## The compliance loop

If you take only one diagram away from this entire curriculum, it should be this one. It's the *compliance loop*, and it's the central mechanic of modern M365 security.

```
   ┌────────────────────────────────────┐
   │ 1. Intune sets policy on the       │
   │    device: encryption on, OS       │
   │    patched, AV running.            │
   └────────────────┬───────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────┐
   │ 2. Device reports its state back   │
   │    to Intune (compliant / not).    │
   └────────────────┬───────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────┐
   │ 3. Intune writes a "compliant" or  │
   │    "non-compliant" attribute onto  │
   │    the device record in Entra ID.  │
   └────────────────┬───────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────┐
   │ 4. User signs in. Conditional      │
   │    Access reads the compliance     │
   │    attribute on the device, plus   │
   │    user / sign-in risk from        │
   │    Entra ID Protection.            │
   └────────────────┬───────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────┐
   │ 5. CA decides: grant, block,       │
   │    grant-with-MFA, or grant with   │
   │    session controls.               │
   └────────────────────────────────────┘
```

Five steps. Three products. One outcome — a decision at the door.

Notice what the diagram is also telling you: **Conditional Access does not configure the device, and Intune does not allow or block sign-ins**. They each do exactly one thing, and they hand off through the compliance attribute on the device record in Entra. The Entra device record is the bridge.

This separation is why "I can't sign in" can be a CA problem, an Intune problem, *or* a Defender problem — and they all feel the same to the user.

## What each one's actual job is

Walk around the loop.

### Intune — the device-state authority

Intune's job is to *configure devices and verify their state*. It does not make sign-in decisions. It does not catch malware. It does not block phishing. It does not investigate incidents.

It does:

- **Configure** the device: push BitLocker, push Defender policies, push browser settings, push application installs, push wallpaper if you're feeling cruel.
- **Enforce compliance policies**: set the bar for what "healthy" looks like (Windows version ≥ X, BitLocker on, AV signature ≤ N days old, no jailbreak).
- **Report compliance state**: the device runs through its policies, succeeds or fails, and reports up. That state lands as `isCompliant: true/false` on the device record in Entra.
- **Trigger Defender for Endpoint deployment**: in most modern setups, Intune is what installs and configures Defender on each device.

If a Conditional Access policy says "require compliant device," Intune is the *answer source* for that requirement. If Intune is wrong about a device's state, CA will be wrong about the sign-in.

**Where it's configured:** `intune.microsoft.com` — the Microsoft Intune admin centre. (Older name: Microsoft Endpoint Manager. Older still: SCCM-on-the-internet.)

### Defender — the threat-detection and response layer

Defender's job is to *detect malicious behaviour and respond to it*. It does not configure devices (Intune does that). It does not make sign-in decisions (CA does that). What Defender does is *watch* and, when correlation is strong enough, *react*.

"Defender" is actually a family of products:

- **Defender for Endpoint** — runs on the device. Behavioural monitoring, EDR, automatic remediation. This is what catches ransomware-like processes, suspicious script chains, credential dumping.
- **Defender for Office 365** — runs on mail flow and SharePoint. Anti-phishing, Safe Links, Safe Attachments.
- **Defender for Cloud Apps** — runs across registered SaaS. User-behaviour analytics, OAuth-grant monitoring.
- **Defender for Identity** — runs against on-prem AD (and hybrid sync). Catches credential-theft and lateral-movement patterns.
- **Defender XDR** — the *correlation* layer that takes signals from all of the above and turns them into incidents. (Whole lesson on this next — lesson 4.)

Defender doesn't normally *block* a single sign-in by itself. What it *does* is feed risk signals into Entra ID Protection, which Conditional Access can then read at policy-evaluation time ("this user's risk is high → require password change"). The signal flows the same direction as Intune's compliance state — into Entra, where CA reads it. Same bridge, different signal.

Defender XDR *can* take direct action through Attack Disruption — disable a user, revoke their tokens, contain a device. That's an exception to the "Defender watches, CA decides" rule, and it's a deliberate one (high-confidence correlation only).

**Where it's configured:** `security.microsoft.com` — the Microsoft Defender portal. (Older name: Microsoft 365 Defender. Older name: ATP. Older still: "we'll rename it next month.")

### Conditional Access — the policy decision point

CA's job is to *evaluate every sign-in against a set of conditions* and decide what to do. It is the only product of the three that makes a yes / no decision at run time.

A CA policy has four parts:

- **Who** — which users or groups it applies to (include / exclude).
- **What** — which apps or actions (Exchange, SharePoint, "all cloud apps", sensitive admin operations).
- **Conditions** — the context: device state, location, sign-in risk, user risk, client app, platform.
- **Controls** — what to do if the policy matches: block, require MFA, require compliant device, require Hybrid join, apply session controls (sign-in frequency, Token Protection).

The decisions CA makes are *the* M365 security boundary in practice. If you have one well-built CA policy in place — "users can read mail only from a compliant device, or after MFA from a trusted location" — most of the threats from card 2 either fail outright or trigger detection somewhere else in the stack.

What CA does NOT do:

- It does not configure devices. (Intune.)
- It does not catch malware. (Defender for Endpoint.)
- It does not block phishing email. (Defender for Office 365.)
- It does not investigate incidents. (Defender XDR.)

**Where it's configured:** `entra.microsoft.com` (or the older `portal.azure.com` → Entra ID → Security → Conditional Access). The Microsoft Entra admin centre.

## Three portals, one mental model

The three-portal sprawl is real. Microsoft has been promising for years to consolidate them. They haven't, and arguably they won't, because each portal has a different audience inside Microsoft (Endpoint team, Security team, Identity team) and a different release cadence.

The mental model that makes the sprawl tractable:

| Question | Portal |
|---|---|
| "Is this device healthy?" | Intune |
| "Is something malicious happening?" | Defender |
| "Was this sign-in allowed, and why?" | Entra (sign-in logs + Conditional Access) |

When you go back to Karen's ticket, the question "why can't she sign in?" decomposes by portal:

- If the **sign-in log in Entra** says "blocked by Conditional Access policy *X*" → CA problem. Open that policy in Entra, look at the matched conditions, find the one that's failing.
- If the sign-in succeeded but Outlook is throwing access errors, and the **device shows non-compliant in Intune** → Intune problem. Open the compliance policy, see what's failing on the device (probably BitLocker turned off or OS out of date).
- If the **sign-in is allowed and the device is compliant**, but the user is being thrown out repeatedly and there are **Defender alerts** on the account → likely token revocation by Defender XDR Attack Disruption. Which is, somewhere underneath the frustration, a good thing — somebody just phished Karen and the system caught it.

Same ticket, three completely different root causes, three completely different remediations.

## Common misconfigurations, and how they manifest

A short field guide, because these come up over and over.

**CA policy excludes the wrong group.** "Require MFA for all users" with the "Guests" exclusion mistakenly applied to a synced group that includes some staff. Half the staff get no MFA enforcement. The MFA-disabled alert in Panoptica365 will fire on those users; before assuming it's a per-user authentication-methods problem, check the CA exclusion list. The bug is almost always at the policy level, not the user level.

**Intune compliance policy too lax.** "Require BitLocker" sounds good, but if the policy doesn't *fail* the device when BitLocker is off, devices can report compliant while not actually being encrypted. Check the compliance policy's failure conditions, not just its target state. A compliance policy that has no teeth is worse than no policy — it gives you false confidence.

**Defender for Endpoint not deployed to all devices.** Intune is *supposed to* push Defender, but exclusion groups, OS variants, or pre-Intune devices slip through. Devices appear in Intune but don't appear in Defender. The Defender XDR device inventory and the Intune device list should match within a couple of percent; if they're significantly off, something is missing. Run that reconciliation periodically.

**CA "Report-only" left on forever.** Report-only is great for testing — CA evaluates the policy and logs what would have happened, but doesn't actually enforce. The mistake is shipping a policy in Report-only and forgetting to flip it to On. The policy "exists" but enforces nothing. Panoptica365's CA drift detector won't flag this on its own; you have to check policy state by hand. Yes, that's annoying. Yes, we know.

**Defender alerts on a user but CA doesn't pick up the risk.** Entra ID Protection P2 is required for risk-based CA. If the customer is on Business Premium (P1 only), CA cannot read the user-risk signal even when Defender is generating it. The alert sits there. The user signs in anyway. This is one of the strongest arguments for upgrading the highest-risk tenants to E5 — covered in lesson 5.

## What this means for the operator

Two practical takeaways.

**When something goes wrong, name the layer first.** "Sign-in failed" is not a root cause; it's a symptom. The root cause lives in CA, in Intune, in Defender, or in the user's authentication methods directly. Identifying the layer before you start changing settings is the difference between a 10-minute fix and a 90-minute fishing trip across three portals.

**Most of your *time* in this stack will be spent on Conditional Access.** Intune is set-and-revisit. Defender largely runs itself. CA needs continuous attention — every new app, every new group of users, every new compliance requirement creates pressure on the CA policy set. That's why card 3 is dedicated entirely to CA template policies. The other tools are configured; CA is *operated*.

## What's next

- **Lesson 4: Defender XDR — what it is, what it isn't.** We touched on it as the correlation layer; lesson 4 is the deep dive into why XDR isn't EDR, isn't SIEM, and isn't a single product.
- **Lesson 5: Microsoft 365 licensing — what unlocks what.** The reason Entra ID Protection (and risk-based CA) isn't available in every tenant.
- **Lesson 6: Where Panoptica365 sits in this picture.** Hint: it doesn't replace any of these three portals. It just makes the noticing-half-of-the-job manageable.

For now: three portals, three jobs, one loop. Intune produces trust signals. Defender produces risk signals. Conditional Access reads both and decides. Every sign-in in M365 runs that loop.

---

*Sources for the data points in this lesson — Microsoft Learn on the Conditional Access compliance loop and device-state evaluation ([Microsoft Learn — Build a Conditional Access policy](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policies)); Microsoft Learn — Defender XDR Attack Disruption mechanics ([Microsoft Learn — Automatic attack disruption](https://learn.microsoft.com/en-us/defender-xdr/automatic-attack-disruption)); Microsoft Intune compliance policy reference ([Microsoft Learn — Use compliance policies](https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started)).*
