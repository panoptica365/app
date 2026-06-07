---
title: "Defender for Endpoint configuration — Windows + macOS"
subtitle: "28 Windows and 3 macOS Defender Antivirus settings that tighten factory defaults against credential theft, AiTM, and ransomware staging."
icon: "shield"
last_updated: 2026-05-29
---

# Defender for Endpoint configuration — Windows + macOS

A Windows endpoint with Microsoft Defender Antivirus running in factory-default mode is reasonably protected against drive-by malware. It's far less protected against the kinds of attacks card 2 spent seven lessons describing — credential theft, AiTM, BEC follow-on, ransomware staging — because the default settings leave several of Defender's stronger detection capabilities under-tuned.

The Panoptica365 Defender Settings templates exist to tighten that default configuration. The Windows template configures 28 specific Defender Antivirus behaviours; the macOS template configures three. Both are needed if the customer has devices on the corresponding platform.

This lesson walks through what each template configures, the choices that matter, and the operational realities of running Defender at production scale.

## Defender Settings Windows — what it configures

The Panoptica365 Defender Settings Windows template uses the Settings Catalog template type (`configurationPolicies`) with platforms set to `windows10` and technologies `mdm,microsoftSense`. The `templateDisplayName` is "Microsoft Defender Antivirus" and the template family is `endpointSecurityAntivirus`. In other words: this is fundamentally a Defender *Antivirus* configuration, deployed through Intune's Endpoint Security policy area (the same surface where MDE / Defender XDR configurations live). The `microsoftSense` technology marker signals the template integrates with the Defender for Endpoint pipeline; it doesn't mean the template configures EDR-layer settings. Every one of the 28 settings tunes Defender Antivirus behaviour.

The specific values in this template aren't arbitrary — most of them track [Jeffrey Appel's MDE series](https://jeffreyappel.nl/tag/mde-series/), a widely-cited practical hardening reference in the M365 security community. Appel is a Microsoft security MVP who walks through individual Defender settings with the reasoning behind each one. That's why the template's posture lands at the aggressive end of what Microsoft considers reasonable rather than middle-of-the-road — it tracks an expert-curated baseline rather than improvised values. Operators who want to understand why a setting is the way it is, or need to defend a choice to a customer, can find the corresponding write-up in the series.

The settings group into four functional clusters:

### 1. Cloud protection and signature lifecycle

The most consequential settings. Defender's modern detection capability depends heavily on cloud-delivered protection — pattern matching, behaviour analysis, and threat intelligence happen in Microsoft's cloud, not on the device.

- **`allowcloudprotection`** — cloud protection enabled.
- **`cloudblocklevel`** = **High Plus** (value 4). Microsoft's scale runs Default → Moderate → High → High Plus → Zero Tolerance. The template skips past the middle and lands on the second-most-aggressive setting. More blocks, more false positives, more confidence that suspicious files are stopped.
- **`cloudextendedtimeout`** = **50 seconds**. Defender will wait up to 50 seconds for a cloud verdict on a suspicious file before falling back to a local-only decision. Microsoft's default is 0 (don't wait at all). 50 is at the higher end of what Microsoft considers reasonable — the template values a deeper analysis over a snappier verdict.
- **`submitsamplesconsent`** = **Send all samples automatically** (value 3). Four options exist: "Always prompt" (0), "Send safe samples" (1, the typical baseline), "Never send" (2), and "Send all samples" (3). The template picks the most aggressive option. This means *any* suspicious file — including potentially sensitive content — may be uploaded to Microsoft for analysis. Worth knowing for customers with strict data-residency or privacy requirements; some will want this dialled back to 1.
- **`signatureupdateinterval`** = **1 hour**. Microsoft's default is once a day. Setting this to 1 hour means Defender pulls signature updates 24× more frequently. This is aggressive — closes the window between a new signature being available and the device having it to roughly the time of a single sync cycle. Has some bandwidth implications on slow networks but most fleets won't notice.
- **`checkforsignaturesbeforerunningscan`** — runs a signature update before any scheduled scan, ensuring the scan uses the latest definitions.
- **`signatureoutofdate`** — not in this template directly, but the Windows compliance policy (lesson 2) checks for stale signatures, completing the loop.

### 2. Behaviour monitoring and protection coverage

Settings that ensure Defender is actually watching the things that need watching:

- **`allowbehaviormonitoring`** — behaviour-based detection enabled (catches malicious behaviour even when the file isn't recognised).
- **`allowrealtimemonitoring`** — real-time scanning of file activity.
- **`realtimescandirection`** = **0** (monitor all files, both incoming and outgoing). The other options (1 = incoming only, 2 = outgoing only) would create blind spots; the template intentionally keeps bidirectional coverage.
- **`allowioavprotection`** — IOAV (Internet/Outlook Attachment) protection enabled. Scans content downloaded by Internet Explorer / Edge / Outlook attachment paths.
- **`allowarchivescanning`** — scans inside .zip, .tar, .rar, etc.
- **`allowemailscanning`** — scans email attachments at the local mail client level.
- **`allowscriptscanning`** — scans script execution (PowerShell, JScript, VBScript).
- **`allowscanningnetworkfiles`** — scans files accessed over network shares.
- **`allowfullscanonmappednetworkdrives`** = **DISABLED**. Scheduled full scans explicitly exclude mapped network drives. This is a deliberate choice — full-scanning mapped drives can take forever, can hammer the file server, and tends to produce spurious detections on shared files. Real-time scanning of network files (via `allowscanningnetworkfiles` above) still applies; it's only the heavy scheduled sweep that skips them.
- **`allowfullscanremovabledrivescanning`** — scheduled scans include removable drives (USB sticks, external SSDs).
- **`enablenetworkprotection`** — Network Protection (the Defender feature that blocks connections to known-bad URLs, complementing SmartScreen).
- **`puaprotection`** = enabled in **block** mode. The other option (audit, value 2) would log without blocking. The template picks block — catches grayware (bundleware, adware, browser hijackers) and prevents installation rather than just logging.

The `enablenetworkprotection` setting is worth flagging specifically — it's the Defender feature that catches AiTM phishing sites when SmartScreen's URL reputation data flags them. The card 2 lesson 3 walkthrough of AiTM mentioned this as one of the secondary mitigations. The template turns it on.

### 3. Scan scheduling and performance

Settings that control *when* and *how aggressively* Defender consumes device resources:

- **`schedulequickscantime`** = **600** (minutes from midnight) = **10:00 AM**. Not off-hours — deliberately mid-morning. The reasoning: SMB laptops are often off overnight. Scheduling a scan at 2 AM means most devices miss it and have to wait for the next slot. 10 AM hits a window where most devices are powered on, logged in, and connected to fast networks. The user notices a small CPU bump during the scan, but the alternative is scans that never run.
- **`avgcpuloadfactor`** = **20** (percent). Defender will use up to 20% of CPU during scans — conservative, prioritises user-perceived performance over scan speed. Microsoft's default is 50%. The lower setting means scans take longer but don't make the device feel slow.
- **`enablelowcpupriority`** — Defender scans run at low process priority when possible.
- **`scanparameter`** = **1** (quick scan, not full scan). Full scans can take hours; quick scans cover the high-probability infection paths in minutes.
- **`disablecatchupquickscan`** = **0** (catchup quick scans **are** allowed). A device that was off when its scheduled quick scan was due will run it at the next opportunity. Don't disable catchup.
- **`disablecatchupfullscan`** = **0** (catchup full scans **are** allowed). Same logic, for full scans.
- **`randomizescheduletasktimes`** — randomises scan start times across the fleet to avoid all devices scanning simultaneously and spiking infrastructure load.

### 4. Endpoint hardening and Defender-internal hardening

A handful of settings that protect Defender itself from being tampered with:

- **`disablelocaladminmerge`** = **1** (local admin merge **disabled**). Local administrators can't override the centrally-managed policy. Without this, a local admin could disable real-time protection on the device.
- **`allowdatagramprocessingonwinserver`** = **1** (enabled). Datagram processing on Windows Server installs (a niche corner-case where Defender behaves slightly differently on server SKUs vs workstation SKUs).
- **`allowuseruiaccess`** = **1** (user UI access **enabled**). Non-admin users can see the Defender UI — view recent scan results, see what was blocked, view threat history. This is a *usability* choice, not a hardening choice (locking the UI from users would be more restrictive). The template values transparency for the end user over hiding Defender from them.

The `disablelocaladminmerge` setting is the security-critical one of this group. Without it, a user with local admin rights on their device can disable Defender entirely — which would silently break the compliance signal (since the Windows compliance policy demands Defender enabled). Setting this to disable-merge ensures the central policy wins.

## Defender Settings macOS — what it configures

The macOS template is dramatically simpler than the Windows one — three settings versus thirty. This reflects the reality that Defender for Endpoint on macOS has a much smaller surface than on Windows, and most of Defender's macOS configuration happens at the install/onboarding stage rather than via Intune policy.

The three settings:

- **`com.apple.managedclient.preferences_enabled`** — Defender enabled on macOS.
- **`com.apple.managedclient.preferences_enablerealtimeprotection`** — real-time protection enabled.
- **`com.apple.managedclient.preferences_automaticsamplesubmission`** — automatic sample submission to Microsoft for analysis.

That's it. The Defender for Endpoint client on macOS is largely self-configuring once installed; this template is mostly there to ensure the three essentials are turned on.

What's *not* in the macOS template:

- No cloud block level setting (macOS Defender uses Microsoft cloud protection by default and doesn't expose a granular block-level knob via MDM).
- No scan scheduling — macOS Defender's scan behaviour is on-access, not scheduled.
- No specific scan-type controls — the macOS Defender doesn't expose archive scanning, email scanning, network file scanning as separate knobs.
- No tamper-protection settings explicitly — macOS sandboxing handles much of this at the OS level.

If a customer's macOS posture demands more than these three settings can express, the configuration is layered at the Defender for Endpoint installation (e.g., via the onboarding package configuration) or via separate macOS configuration profiles outside this template's scope.

## The pairing with the compliance policy

The Defender configurations only matter if the compliance policy actually checks for them. The Panoptica365 Windows compliance policy (lesson 2) checks:

- `defenderEnabled: true` — Defender must be enabled. The Defender Settings template ensures it.
- `rtpEnabled: true` — real-time protection enabled. The Defender Settings template's `allowrealtimemonitoring` delivers it.
- `antivirusRequired: true` and `antiSpywareRequired: true` — antivirus and anti-spyware engines required. Defender provides both.
- `signatureOutOfDate: true` — flags devices with stale signatures. The Defender Settings template's faster signature update interval reduces the window for this.
- `deviceThreatProtectionEnabled: true` at level "low" — Defender for Endpoint reports no high-confidence threats. The Defender Settings template doesn't directly configure this (it's a state, not a setting), but the configurations help reduce the chances of devices being flagged.

So the two templates work together: the configuration template makes the device deserving of compliance; the compliance policy verifies the device meets the bar.

The macOS pair is lighter — the Panoptica365 macOS compliance policy doesn't include `deviceThreatProtectionEnabled` because Defender for Endpoint on macOS isn't always installed in SMB scenarios. The macOS Defender Settings template, when deployed, configures what Defender is there to configure, but Defender presence isn't itself a compliance requirement.

## What can break

Defender configurations are mostly safe but worth knowing about:

**Cloud protection false positives.** Aggressive cloud block levels (higher than default) catch more threats but also flag more legitimate files as suspicious. Common false-positive sources: custom-built business apps, older versions of common tools, niche software. The fix is *exclusions* — exclude specific paths or files from scanning via the Defender exclusions setting (not directly in the Panoptica365 template; configured per-customer as needed).

**Performance complaints on older devices.** Real-time scanning + behaviour monitoring + archive scanning is heavier than factory defaults. Devices with 4GB RAM and spinning HDDs may feel slower with the template active. The `avgcpuloadfactor` and `enablelowcpupriority` settings help, but the underlying issue is old hardware. The honest fix is hardware upgrade; the workaround is exclusions.

**Network Protection blocking legitimate URLs.** When `enablenetworkprotection` is on, occasionally a legitimate business URL gets caught (false positive in Microsoft's threat intelligence). The user sees a "this site is blocked" screen. The fix is a custom allowlist in Defender's URL allowlist, configured via a separate Defender Settings adjustment per customer.

**PowerShell scanning + legitimate scripts.** `allowscriptscanning` catches malicious PowerShell, but also catches some heavy legitimate scripts (admin automation, large IT operational scripts). Performance can degrade for users running these. Exclusions are per-customer as needed.

## Rollout

Pilot-group deployment from lesson 1's pre-flight:

1. **Day 0** — deploy the Windows template to a pilot group of 3–5 devices. Deploy the macOS template if the customer has Macs.
2. **Days 1–7** — verify deployment in Intune portal (success counts). Spot-check pilot devices — open the Defender UI, confirm Cloud Protection shows enabled, signature definitions are current, real-time protection is on.
3. **Days 7–14** — observe pilot device behaviour. Watch for false-positive blocks, performance complaints, signature update failures.
4. **Day 14** — broader deployment if pilot is clean.

The Defender template is among the safer templates to deploy because Microsoft has decades of experience tuning Defender for compatibility. Most customers see no user-visible behaviour change; the work happens in Defender's background processes.

## What to monitor after enforcement

**Defender enabled / disabled per device.** Should be 100% enabled on Windows fleet after deployment. Devices showing Defender disabled are devices where the template failed to apply or where local admin tampering disabled it — investigate.

**Signature freshness.** Devices reporting stale signatures (more than 24 hours old) usually indicate connectivity issues, signature update mechanism broken, or — rarely — Defender itself has been disabled by another product. Watch for this in the Intune compliance state for the device (signature-out-of-date is one of the checks the Panoptica365 Windows compliance policy performs); a device flipping out of compliant will roll up into the overall compliance count tile, but per-device signature age isn't a dedicated view in Panoptica365.

**Defender threat detections.** Spike in detections often correlates with a phishing wave hitting the customer, or with a single user clicking through Network Protection blocks repeatedly (suggesting they're being targeted). Investigate the source pattern.

**False positives reported by users.** Track each one. Some need exclusions; some are real threats the user misidentified as legitimate.

**Drift on the template.** Defender settings are a common drift target. A customer's other admin may have adjusted the cloud block level down, or enabled features the template doesn't enable. Panoptica365's drift detector flags this.

## What Panoptica365 sees

Two real things, and a long list of things it doesn't.

**What Panoptica365 surfaces:**

- **Defender XDR detections as alerts.** When the customer's Defender XDR ingestion is configured (card 1 lesson 4), incidents and high-severity alerts flow into Panoptica365's alert engine, where they're surfaced through the same dashboard and email pipeline as other security alerts. This is the per-customer detection feed — but it lives in the alerts surface, not in a per-device view.
- **Drift on the Defender Settings template.** If a customer's tenant drifts from the deployed template — somebody adjusted the cloud block level, enabled features the template doesn't enable, disabled tamper protection — the drift detector fires. Revert, reapply, or accept, same as the rest of the drift workflow.

**What Panoptica365 does *not* surface** (in case the curriculum led you to expect it):

- Per-device Defender enabled state
- Per-device signature age
- Per-device real-time protection state
- Any per-device Defender posture at all

Per-device visibility for Defender state lives in the Microsoft 365 Defender portal and the Intune device blade. That's the diagnostic surface today. Panoptica365's role is alerts (when something bad happens) and drift (when the configuration weakens) — not per-device posture reporting.

Defender XDR's role in this template pair is to surface the *detection events* that the configuration enables Defender to find. Card 1 lesson 4 covered XDR; here, the Defender Settings template is what makes XDR's signals actually arrive — without proper Defender configuration, the XDR signal stream is thin.

## What this means for the operator

Three takeaways.

**Defender configuration matters as much as Defender presence.** A factory-default Defender install is meaningfully weaker than a properly-configured one. The Panoptica365 template is the difference. Deploy it on every Windows fleet.

**Cloud protection is the most consequential cluster.** Of the 28 Windows settings, the cloud protection ones (High Plus block level, send-all-samples consent, 50-second cloud timeout, 1-hour signature interval) move the needle most. They're also the most aggressive in the template — if you're customising for a regulated customer or one with data-residency concerns, the sample-submission setting (currently "Send all samples") is the first one to consider dialling back to "Send safe samples."

**Tamper protection matters operationally.** `disablelocaladminmerge` prevents a user with local admin from disabling Defender. Without it, the compliance signal is fragile — a user can break their own compliance by turning Defender off, and the central policy can't override them.

## What's next

- **Lesson 6: Firewall Settings (Windows).** Host firewall configuration — the other half of Windows endpoint network defence.
- **Lesson 7: ASR Rules + Block mshta.exe.** Attack surface reduction rules — Defender's pre-emptive behaviour-block features.

For now: Defender Settings is the configuration that makes Defender actually defend. Deploy on every Windows fleet; deploy the macOS counterpart where applicable; pair both with the corresponding compliance policy.

---

*Sources for the data points in this lesson — most of the Panoptica365 Defender Settings Windows values track Jeffrey Appel's MDE series ([jeffreyappel.nl/tag/mde-series](https://jeffreyappel.nl/tag/mde-series/)), the practical M365 hardening reference the template is built on. Microsoft Learn on Defender Antivirus configuration via Intune ([Microsoft Learn — Configure Defender Antivirus](https://learn.microsoft.com/en-us/defender-endpoint/microsoft-defender-antivirus-windows)); cloud-delivered protection and cloud block levels ([Microsoft Learn — Cloud-delivered protection](https://learn.microsoft.com/en-us/defender-endpoint/cloud-protection-microsoft-defender-antivirus)); Network Protection ([Microsoft Learn — Network protection](https://learn.microsoft.com/en-us/defender-endpoint/network-protection)); Defender for Endpoint on macOS ([Microsoft Learn — Defender for Endpoint on macOS](https://learn.microsoft.com/en-us/defender-endpoint/microsoft-defender-endpoint-mac)).*
