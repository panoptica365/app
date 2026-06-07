---
title: "Compliance policies — defining \"compliant\" across four platforms"
subtitle: "The four Panoptica365 compliance policies — Windows, iOS, Android, macOS — and the minimum bar each one enforces."
icon: "monitor-check"
last_updated: 2026-05-29
---

# Compliance policies — defining "compliant" across four platforms

A compliance policy is the document that answers a single question: *what does it mean for a device to be considered "compliant" in this customer's tenant?*

The answer feeds straight into Conditional Access. When a CA policy says "require compliant device" (the AiTM-killer pattern from card 3 lesson 4), the device-compliance signal it reads comes from the compliance policy you wrote. Not the Intune configuration profile that *enforces* settings on the device — the compliance policy that *evaluates* whether the device meets the bar.

This distinction matters and gets confused often. The Panoptica365 BitLocker Settings template *makes BitLocker happen* on Windows devices. The Panoptica365 Windows Compliance policy *checks whether BitLocker is on* and reports compliant or non-compliant accordingly. Same outcome (BitLocker enabled), two different policies doing different jobs. You need both.

This lesson walks through the four compliance policies in the Panoptica365 library: Windows, iOS/iPadOS, Android, and macOS. Each is small (under 2KB of JSON), opinionated, and intentionally lenient — they define the minimum bar, not the aspirational target.

## The four policies

### Panoptica365 - Windows Compliance

The Windows compliance policy is the most consequential because Windows is the dominant managed-device platform in SMB MSP environments. What it actually checks:

- **Defender enabled** (`defenderEnabled: true`) — Microsoft Defender Antivirus must be running.
- **Real-time protection enabled** (`rtpEnabled: true`) — RTP must be on, not just installed.
- **Antivirus required** (`antivirusRequired: true`) — an antivirus must be present.
- **Anti-spyware required** (`antiSpywareRequired: true`) — anti-spyware engine present.
- **Active firewall required** (`activeFirewallRequired: true`) — Windows Defender Firewall must be active.
- **Signature out of date check** (`signatureOutOfDate: true`) — flags devices with stale AV signatures.
- **Device threat protection enabled** (`deviceThreatProtectionEnabled: true`) at level `low` — Defender for Endpoint must report no high-confidence threats.

What it *deliberately doesn't check:*

- **BitLocker** is *not* required. (Notice the `bitLockerEnabled: false`.) That's a real choice. BitLocker enforcement happens via the BitLocker Settings template (lesson 4); the compliance policy doesn't demand it.
- **Password** is *not* required. (`passwordRequired: false`.) Windows password enforcement comes from the Security Baseline (lesson 3) or Group Policy elsewhere.
- **TPM** is *not* required. (`tpmRequired: false`.) Most modern Windows hardware has TPM, but requiring it would fail compliance for older fleet devices.
- **Secure Boot** is *not* required. Same reason.
- **OS minimum version** is *not* set. The compliance policy doesn't demand Windows 11 or any specific build.

Why the leniency? Because the compliance policy is the *minimum bar for CA's compliant-device gate*. If you set it too high, devices that are otherwise correctly configured fail compliance and lose access to M365 — even when nothing's wrong with them from a security perspective. The Panoptica365 Windows compliance policy errs on the side of "if Defender is running, this device is compliant enough to access M365." Hardening beyond that bar happens in the configuration templates (BitLocker, Security Baseline, ASR Rules) — separately from the compliance evaluation.

This is a *defensible* choice. A different MSP might require BitLocker as a compliance criterion. The trade-off: stricter compliance criteria catch more security gaps but also produce more false-positive non-compliance findings when device state is briefly inconsistent (BitLocker temporarily disabled for a recovery operation, signatures briefly stale during an update window, etc.). The lenient bar prioritises stability of the CA-compliant-device signal over aggressive hardening.

### Panoptica365 - iOS/iPadOS Compliance

Mobile compliance is light by design. iOS devices in the SMB context are overwhelmingly BYOD — personal phones used to read corporate email. Full MDM enrolment on a personal phone is something users push back on and many MSPs don't try to enforce.

What the iOS policy checks:

- **Passcode required** (`passcodeRequired: true`) — device must have a passcode.
- **Minimum passcode length: 4 characters.**
- **Maximum 5 minutes of inactivity before lock** (`passcodeMinutesOfInactivityBeforeLock: 5`).
- **24-passcode previous-block count** — can't reuse the last 24 passcodes.
- **Jailbreak detection** (`securityBlockJailbrokenDevices: true`) — blocks devices flagged as jailbroken.

What it doesn't check:

- **OS minimum version** is not set. iOS gets security updates aggressively; users generally are on current versions; demanding a specific minimum would catch a small number of devices on old iOS releases who probably can't update anyway.
- **Device Threat Protection** is not required (Defender for Endpoint on iOS exists but isn't standard for SMB BYOD).
- **Managed email profile** is not required. Users access email through their consumer Outlook/Apple Mail app, not through a managed configuration.

The honest framing: this policy ensures the basics (passcode + lock screen + not-jailbroken) and accepts that the rest of mobile-device hardening is outside the SMB-MSP scope. If a customer wants stricter mobile MDM, they want a different MSP relationship.

### Panoptica365 - Android Compliance

The Android policy is configured for **Android Open Source Project (AOSP) Device Owner** mode — the Android Enterprise model. What it checks:

- **Storage encryption required** (`storageRequireEncryption: true`) — device encryption must be enabled.
- **Password required** (`passwordRequired: true`).
- **15 minutes of inactivity before lock** (`passwordMinutesOfInactivityBeforeLock: 15`).
- **Jailbreak / root detection** (`securityBlockJailbrokenDevices: true`).

Notably absent: minimum OS version, minimum Android security patch level, app verification. Same reasoning as iOS — these would fail compliance on devices that customers can't easily upgrade.

The AOSP Device Owner mode is specifically for *corporate-owned, fully-managed* Android devices. For *personally-owned* Android devices using a work profile, the compliance policy structure is slightly different and not represented in the Panoptica365 library. If a customer has a meaningful Android-BYOD fleet, this template doesn't cover that scenario directly — and the Panoptica365 mobile scope is "compliance signal for what's enrolled, nothing more."

### Panoptica365 - macOS Compliance

macOS gets less attention in most SMB MSP contexts because the fleet is small. The compliance policy reflects that:

- **Password required** (`passwordRequired: true`).
- **Minimum password length: 6 characters.**
- **Storage encryption required** (`storageRequireEncryption: true`) — FileVault must be on.
- **Firewall enabled** (`firewallEnabled: true`) — macOS firewall on.
- **Firewall blocks all incoming** (`firewallBlockAllIncoming: true`) — strict inbound block.

Notably *not* required: System Integrity Protection (SIP). Most modern macOS installations have SIP enabled by default, but it can be disabled by sophisticated users. The compliance policy doesn't demand it.

Also notably: `gatekeeperAllowedAppSource: "anywhere"` — the compliance policy doesn't enforce Gatekeeper restrictions on app sources. This is permissive; a stricter policy would set this to `macAppStore` or `macAppStoreAndIdentifiedDevelopers`. The Panoptica365 default accepts whatever the customer has configured at the OS level.

For most SMB tenants with one or two Mac users, this compliance bar is appropriate. For customers with substantial Mac fleets (creative agencies, dev shops), the operator should consider tightening this template via the customisation workflow in lesson 10.

## The compliance signal vs the configuration

A pattern worth naming explicitly: the Panoptica365 library treats compliance and configuration as separate concerns. Each compliance policy is paired with one or more configuration templates that *make* the device meet that bar.

For Windows:
- Compliance policy says "Defender must be enabled" → configuration delivered by Defender Settings template (lesson 5).
- Compliance policy says "firewall must be active" → configuration delivered by Firewall Settings template (lesson 6).
- (BitLocker is not in the compliance bar but IS in the configuration → BitLocker Settings template, lesson 4.)

For macOS, there *is* a paired configuration template — **Panoptica365 - Defender Settings macOS** (covered in lesson 5). It turns on Defender for macOS, enables real-time protection, and enables automatic sample submission. So the macOS pair exists, but it's structurally lighter than the Windows pair — and the reason is Microsoft, not Panoptica365. The macOS compliance policy in Intune exposes exactly these criteria: System Integrity Protection, OS version, password rules, FileVault, firewall + stealth mode, and Gatekeeper. That's the whole list. No Defender row, no real-time-protection row, no Device Threat Protection level (which on Windows is the Defender-for-Endpoint health signal). You can *configure* Defender on macOS via the configuration template; you cannot *check* its state through the compliance policy at all. The Panoptica365 macOS compliance policy therefore checks the things Microsoft surfaces, and the Defender Settings macOS template handles the configuration side without a matching compliance check. If you've wondered why the macOS story feels half-finished, this is why.

For iOS and Android: there's no paired configuration template in the Panoptica365 library — only the compliance policy. The configuration is the user's responsibility (they set their own passcode, they keep encryption on).

This separation reflects the real business model: full configuration-plus-compliance management on Windows (because the MSP effectively owns those devices via the customer); a lighter configuration pair on macOS limited by what Microsoft's compliance API supports; compliance-signal-only on iOS and Android (because the MSP doesn't own those devices and can't push configuration).

The honest takeaway: a customer who wants their iPhones, iPads, or Android devices to be *managed* (not just *checked for compliance*) needs a different conversation. Panoptica365's bundled library doesn't cover that scenario by design. Operators who need it — or who need deeper macOS configuration beyond Defender — can build their own configuration templates and import them via the workflow in lesson 10.

## Rollout

Compliance policies deploy in Enabled state, like all Panoptica365 templates. For these specific policies, the deploy-hot approach is almost always safe — the bar is intentionally low and the checks are conservative:

- A new Windows device with Defender running passes immediately.
- A new iPhone with a passcode and not jailbroken passes immediately.
- A new Mac with FileVault on passes immediately.

The pilot-group deployment from lesson 1's pre-flight is still recommended, but the verification window is short — 24–48 hours is usually enough. Look for:

- Devices marked **Not yet evaluated** that should have evaluated by now (indicates compliance-loop break — see lesson 9).
- Devices marked **Non-compliant** for a reason that surprises you. Common surprise: a Defender signature timing window where a device briefly shows non-compliant due to staleness.
- Devices that *don't appear* in the compliance evaluation at all. Usually means they're not Intune-enrolled and the policy has no target.

After enforcement (which for compliance policies is "deployed and being evaluated"), monitor:

- **Overall compliance ratio.** Panoptica365's devices tile gives you the headline (e.g., "32/57 compliant"). Healthy is 95%+ compliant for the evaluated set. Below 90% means something structural is wrong — template misconfigured, infrastructure problem, or a chunk of devices that shouldn't be enrolled.
- **Per-platform sanity check.** Use the Devices by OS breakdown to confirm the platform mix is what you expect. If you see counts shift unexpectedly (a chunk of Windows devices disappears, an unfamiliar OS appears), that's worth investigating.
- **Common non-compliance reasons.** Drill into non-compliant devices in the Intune portal and read the specific failure reason — Microsoft surfaces which check failed per device. If "Defender disabled" appears across multiple devices, you have a real problem (Defender shouldn't be off on managed Windows machines). A few in isolation are noise; a cluster of the same reason is signal. Panoptica365 doesn't aggregate these reasons for you, so pattern-spotting is manual work in the Intune portal.
- **Devices repeatedly flipping between compliant and non-compliant.** This is "compliance flapping" — usually a sync-timing issue or a setting that's enforced unevenly by a configuration template. Catching it is manual: notice in the Intune portal that a device has bounced state multiple times in a week, then investigate per device. Lesson 9 walks through the failure modes.

## What Panoptica365 sees

Compliance state per device flows into Panoptica365 from Microsoft Graph. The customer dashboard surfaces three things about it, deliberately kept high-level:

- **The Intune Managed Devices list** — every enrolled device with its OS, current compliance state (compliant / not compliant / not evaluated), assigned user, and last sync timestamp. The "not evaluated" bucket includes things like Windows Servers that aren't handled by Intune at all — they show up because they're Entra-registered but they never get a compliance verdict.
- **A "Compliant Devices" tile** — the headline is the compliance percentage in big type (e.g., "94%" or "60%"), colour-coded by posture (green when healthy, red when weak). The subtitle reads "X of Y compliant, Z not evaluated" — three numbers that tell you the whole story: how many devices Panoptica365 successfully evaluated, how many of those passed, and how many enrolled devices never got a verdict (typically servers Intune doesn't handle, freshly-enrolled devices still in their first sync window, or devices with broken Intune clients). When the percentage changes between polls, a trend arrow shows direction — red down on a drop, green up on an improvement.
- **Devices by OS** — a count breakdown (Windows N, iOS N, Android N, Windows Server N, etc.).

That's the surface. The per-device failure reason, the >24-hour triage queue, the flapping pattern — those don't live in Panoptica365's dashboard. They live in the Intune portal, one device at a time. The platform points at *that* something is off (a device fell out of compliant, the compliant count dropped); Microsoft tells you *why*.

This is consistent with how Panoptica365 is positioned generally — read-only, alert-driven, drill into Microsoft's own consoles for the deep diagnosis. The compliance-loop lesson (lesson 9) walks through what operational monitoring looks like in practice with this split.

## What this means for the operator

Three takeaways.

**Compliance is a bar, not a configuration.** These four policies *evaluate* devices; they don't *configure* devices. The configuration templates in lessons 3–8 do the configuration. Both are needed.

**Lenient compliance bars are a feature, not a bug.** A strict compliance policy that catches every device state inconsistency produces a noisy CA signal. The Panoptica365 defaults err toward stability. Customers who need stricter compliance (regulated industries, post-incident hardening) can customise — but the defaults are appropriate for most SMB tenants.

**Mobile and macOS compliance are scope statements as much as security controls.** They tell the customer "this is what we check; this is what we don't." Operators who want deeper mobile/macOS management need to build their own templates (lesson 10) or accept that those platforms are managed lightly.

## What's next

- **Lesson 3: The Security Baseline.** The curated Windows hardening bundle — your largest single template.
- **Lesson 4: BitLocker Settings.** Disk encryption configuration that the Windows compliance policy *doesn't* require but the Panoptica365 hardening posture does deploy.

For now: deploy the four compliance policies as a unit. They're the foundation for CA's compliant-device path. Without them, the cards 3.4 and 3.5 templates have nothing to read against.

---

*Sources for the data points in this lesson — Microsoft Learn on compliance policy structure ([Microsoft Learn — Device compliance policies](https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started)); Windows compliance policy reference ([Microsoft Learn — Windows 10/11 compliance settings](https://learn.microsoft.com/en-us/mem/intune/protect/compliance-policy-create-windows)); iOS compliance settings ([Microsoft Learn — iOS/iPadOS compliance settings](https://learn.microsoft.com/en-us/mem/intune/protect/compliance-policy-create-ios)); Android Enterprise compliance ([Microsoft Learn — Android Enterprise compliance settings](https://learn.microsoft.com/en-us/mem/intune/protect/compliance-policy-create-android-for-work)); macOS compliance ([Microsoft Learn — macOS compliance settings](https://learn.microsoft.com/en-us/mem/intune/protect/compliance-policy-create-mac-os)).*
