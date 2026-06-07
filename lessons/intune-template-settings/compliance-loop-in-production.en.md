---
title: "The compliance loop in production — drift, signals, and what to watch"
subtitle: "How the Intune→Entra→CA compliance signal actually behaves in production: timing, failure modes, and what Panoptica365 surfaces."
icon: "repeat"
last_updated: 2026-05-29
---

# The compliance loop in production — drift, signals, and what to watch

Card 1 lesson 3 described the compliance loop as a five-step diagram: Intune sets policy on the device → device reports state → Intune writes compliance to Entra → CA reads compliance → CA decides. Clean and abstract.

In production, the loop is messier. Devices go offline and the loop pauses. Policies update and devices take hours to re-evaluate. Compliance evaluation depends on signals that themselves depend on other signals (Defender must report healthy *and* signatures must be current *and* the firewall must be active...). When something breaks, the question is rarely "is the compliance loop broken?" — it's "*which* of the dozen things that could go wrong has gone wrong?"

This lesson walks through how the compliance loop actually behaves in production: where signals come from, how often they update, what failure modes look like, and how Panoptica365 surfaces the patterns that matter.

## The signal flow, with timing

The compliance state visible on a CA policy at sign-in time has travelled through several systems with their own update cadences:

1. **The device evaluates its own state** against the assigned compliance policy. On Windows, this typically happens at device boot, at user logon, on Intune sync (every 8 hours by default), and on demand if the user or admin triggers a sync. Mobile platforms have similar but separate cadences.
2. **The device reports its compliance state to Intune.** This is the network call from device → Intune. Requires the device to be online; gets queued if offline.
3. **Intune writes the compliance attribute to the Entra ID device record.** This is an Intune → Entra synchronisation step. Typically near-real-time when both services are healthy but can lag during high-load periods.
4. **CA reads the Entra device record at sign-in.** This is the moment of evaluation. CA looks at the device's current compliance state in Entra.

The cumulative lag between "device state changes" and "CA reflects the new state at sign-in" can be anywhere from seconds to about 8 hours, depending on where in the cycle the change happens. For most operational scenarios, lag is in the minutes-to-hours range.

This matters because users sometimes report "I fixed the issue but I'm still blocked" — and the answer is usually "the signal hasn't propagated yet; try again in 30 minutes." Knowing the timing helps you set user expectations correctly.

## The failure modes

The loop breaks in identifiable ways. Each has a different remediation.

### "Not yet evaluated"

A device shows compliance state "Not yet evaluated" in the Entra device record. There are four distinct reasons this can happen, and they need different responses:

- **The device is brand new to Intune** — just enrolled, first evaluation hasn't completed. Will resolve itself within the first 8-hour sync cycle.
- **The device hasn't synced with Intune in a long time** — probably offline. Will resolve when the device comes back online and re-syncs.
- **The device's Intune client is broken and not syncing.** Will *not* resolve on its own — needs operator intervention (force sync, repair the client, or re-enrol).
- **The device isn't actually managed by Intune at all.** The classic example: a Windows Server that's onboarded into Microsoft Defender for Endpoint but never enrolled in Intune. The server shows up in the Intune Managed Devices list because Entra knows about it, but it has no Intune compliance policy assigned and will never get a compliance verdict no matter how long you wait. Same goes for Entra-registered-but-not-MDM-enrolled devices, devices in a hybrid trust state where MDM enrolment failed, and devices managed by a different MDM (rare in SMB, but possible). These show as "not evaluated" forever — it's not a transient state, it's a structural one.

CA policies typically treat "Not yet evaluated" as **non-compliant**. This is the secure default — a device whose state we don't know shouldn't be granted compliant-device access. The implications differ by reason:

- For the first two reasons (transient), users may be blocked temporarily and access restores once evaluation completes. Plan for this — new device onboarding shouldn't happen on a Friday afternoon if the user needs to sign in over the weekend.
- For the third reason (broken client), users stay blocked until the underlying problem gets fixed. Investigate per device.
- For the fourth reason (not Intune-managed), the device will *permanently* fail any CA policy that requires compliant device. This usually doesn't matter for servers (they don't sign into M365 interactively), but it occasionally surprises an operator who's set a "require compliant device" CA scope that accidentally includes service accounts running on those servers. If you ever see a CA-blocked service account that worked yesterday, check whether the device it runs on is Intune-managed — if it isn't, the CA policy and the device's enrolment state are fundamentally incompatible.

### "Non-compliant" persistent

A device shows non-compliant for hours or days and doesn't recover. Causes:

- A required setting is genuinely not in place. Defender is disabled, BitLocker is off, firewall is disabled. The compliance check is correctly catching the gap.
- A required setting is in place but Intune evaluation is reporting it wrong. Common with: Defender signatures briefly going stale during update, BitLocker temporarily disabled for a recovery operation, firewall briefly off during a service restart.
- The device's reporting is out of sync. The device is actually fine but its self-reported state hasn't refreshed.

For persistent non-compliance lasting more than 24 hours, the workflow is:

1. Check Intune portal for the specific failure reason. The compliance state shows *why* the device is non-compliant — which specific check failed.
2. Verify on the device itself. Use `Get-MpComputerStatus` (PowerShell) for Defender state, `manage-bde -status` for BitLocker, the Defender Firewall UI for firewall state.
3. If the device is genuinely non-compliant, fix the underlying issue. Re-enable Defender, complete BitLocker encryption, turn firewall back on.
4. If the device is fine but Intune is reporting it wrong, force a sync (Settings → Accounts → Access work or school → Sync, or run `dsregcmd /sync` in PowerShell). Wait 30 minutes for the new state to propagate.
5. If sync doesn't resolve it, the Intune client on the device may need to be repaired or re-enrolled.

### Compliance flapping

A device flips between compliant and non-compliant rapidly — every few hours, every day, on its own schedule. This is "flapping" and is one of the more annoying patterns to diagnose. Common causes:

- **Defender signature timing.** Defender signatures expire on a regular cadence. If the update arrives slightly after the compliance evaluation, the device flips non-compliant briefly until the next signature update arrives.
- **Configuration profile conflict.** Two Intune configuration profiles configure the same setting differently. The device alternates between the two states depending on which one was most recently applied.
- **User-initiated disable.** A user with local admin rights disables Defender (or another required service), the compliance check catches it, the device is non-compliant. The user turns Defender back on (or it auto-restarts on a schedule). The device returns to compliant. Repeats.
- **Sync timing race condition.** The compliance evaluation runs at a slightly different schedule than the configuration profile enforcement. A device that's right at the edge of a threshold can flip back and forth based on which check happened most recently.

Flapping is usually fixed by identifying the underlying cause. Detecting it today is manual — watch the Intune portal's per-device compliance history for devices that have bounced state multiple times in a short window, and investigate those specifically.

### Compliant but broken

A device shows compliant but the user can't sign in to M365. The CA policy is enforcing compliant device, the device is compliant, and yet the sign-in fails. This is rare but it happens. Causes:

- **Stale Entra device object.** The device record in Entra is duplicated or orphaned from earlier enrolments. CA reads a different device record than the one Intune is reporting to.
- **Trust state mismatch.** Hybrid Azure AD join is broken; the device thinks it's hybrid-joined but Entra has a different view.
- **CA policy condition mismatch.** The CA policy is reading a specific compliance signal that's distinct from the general compliance state.

For these cases, the device usually needs to be cleaned up — disjoin and rejoin Entra, repair the trust state, or remove the orphaned device record manually.

### Compliance loop broken silently

The worst failure mode: the loop appears to be working but isn't. A device is non-compliant on the OS but Intune is reporting it compliant. CA grants access. Nobody notices because nothing surfaces as a problem.

Causes are usually structural — Intune client tampered with, malware affecting the reporting agent, deeply broken state from a botched enrolment. These cases are rare but worth knowing about: don't assume compliance state is true just because it's reported as true. Periodic spot-checks on random devices, comparing reported state to actual state, are a useful audit practice.

## Windows Health Monitoring's role

The Panoptica365 library includes a small (595-byte) template called **Windows Health Monitoring**. It does a single thing:

- Enables `allowDeviceHealthMonitoring`.
- Scopes monitoring to `bootPerformance,windowsUpdates`.

This template configures Windows to collect health telemetry about boot performance and Windows Update activity. The data feeds into the Intune device health view and into Endpoint Analytics if the customer has that enabled.

It's not a security control. It's an *observability* control. It tells the operator how the customer's Windows fleet is behaving over time — slow boots, frequent crashes, repeated update failures. The data is useful for proactive troubleshooting ("this device is going to fail soon"), not for compliance evaluation.

For Panoptica365's compliance loop purposes, Windows Health Monitoring is essentially invisible — the data doesn't flow into the compliance state. But it's worth knowing the template exists and what it does, because operators looking at the Intune portal will see it deployed alongside the security templates.

## How Panoptica365 surfaces the compliance loop

Panoptica365's customer dashboard takes a deliberately thin slice of the compliance loop. Three surfaces, all high-level:

**The Intune Managed Devices list.** Every Intune-enrolled device, with OS, current compliance state (compliant / not compliant / not evaluated), assigned user, and last sync timestamp. The "not evaluated" bucket also covers devices Intune doesn't handle at all (like Windows Servers) — they appear in the list because Entra knows about them, but they never get a compliance verdict. The table you scan when something feels off.

**The "Compliant Devices" tile.** Percentage as the headline (e.g., "94%" or "60%"), colour-coded by posture — green when healthy, red when weak. The subtitle reads "X of Y compliant, Z not evaluated," giving you three numbers in one line: how many devices Panoptica365 evaluated, how many of those passed, and how many enrolled devices never got a verdict at all. The denominator of the percentage is the evaluated set; the not-evaluated devices are surfaced separately rather than dragging the ratio down. A trend arrow appears when the percentage moves between polls — red down on a drop, green up on an improvement. The point: you don't have to remember yesterday's number to know which direction the customer is moving.

**Devices by OS.** A count breakdown per operating system (Windows, Windows Server, iOS, Android, etc.). Useful for sanity-checking the platform mix and for noticing when a count shifts unexpectedly (a new Mac appears, a chunk of Windows devices fall off).

That's the surface. Panoptica365 does **not** surface, in the dashboard, the things you might expect from a "compliance dashboard" in the heavier sense:

- A "top non-compliance reasons" breakdown across the fleet
- A "non-compliant for more than 24 hours" triage queue
- A flapping-devices list
- Per-device failure reason callouts

Those investigations happen in the Intune portal itself, one device at a time. The split is intentional: Panoptica365 tells you *that* compliance is moving — the count dropped, a device fell to unknown, the tenant's overall posture is weakening. Microsoft's Intune console tells you *why* — which specific check failed, what setting is missing, what the device's last error was.

The implication for operators: use Panoptica365's compliance view as a tripwire (daily scan, look for changes) and Intune as the diagnostic console (drill in once something looks wrong). Skipping either side breaks the workflow — Panoptica365 alone gives you the signal without the diagnosis; Intune alone makes you log into 30 portals one by one to notice the signal in the first place.

## What operators actually do with this

The day-to-day operator workflow around the compliance loop:

**Morning check (weekly minimum, daily ideal):** open the customer dashboard. Look at the devices tile (compliant count, evaluated count, total). If the compliant ratio has dropped versus what you remember from yesterday, or the "unknown" gap has widened, scan the Intune Managed Devices list for outliers — devices that flipped to unknown, devices with stale last-sync timestamps, devices you don't recognise.

**Per-incident triage:** when a user reports they can't sign in to M365 because their device is non-compliant, the playbook is the failure-mode triage from earlier in this lesson. Open the device in the Intune portal, read the specific failure reason, verify on the device, force sync if needed, fix the underlying issue.

**Monthly review:** for each customer, open the Intune portal and look at the per-device compliance reasons across non-compliant devices. Pattern-spot manually: if "Defender disabled" appears on devices across multiple customers, there may be a deployment script or RMM tool inadvertently disabling Defender. If "BitLocker not enabled" is showing up, there might be hardware (TPM-less devices) that aren't catching the BitLocker template. This is genuinely manual work today — Panoptica365 doesn't aggregate the reasons for you across the fleet, so the pattern-spotting depends on the operator doing the drill-downs.

**Quarterly audit:** spot-check a few random compliant devices per customer. Compare reported state to actual state. Confirm the loop is working for those devices. Usually fine; occasionally surfaces the "silently broken" failure mode that nothing else catches.

## What this means for the operator

Three takeaways.

**The compliance loop has timing. Communicate that to users.** When a user fixes their device and is still blocked, the most likely explanation is propagation delay, not a deeper problem. Telling them to wait 30 minutes and try again resolves most cases.

**Persistent non-compliance is a triage queue, not a one-time fix.** Devices show up in non-compliance for many reasons; some need immediate attention (security gap), some need patience (sync delay), some need remediation (broken Intune client). Treat the list as a recurring operational responsibility.

**Spot-check the silently-broken case quarterly.** The most insidious compliance loop failure is the one that never surfaces as a problem. Random device audits catch this where nothing else does.

## What's next

- **Lesson 10: Importing your own Intune templates.** When the bundled library doesn't cover what you need.
- **Lesson 11: Operating Intune at scale.** Drift, exclusions, lifecycle.

For now: the compliance loop is the foundation that makes everything in card 4 *valuable*. Without monitoring it in production, the templates deploy but their effect is invisible. Treat the compliance dashboard as a daily operational surface.

---

*Sources for the data points in this lesson — Microsoft Learn on compliance policy evaluation cadence ([Microsoft Learn — Compliance policies](https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started)); Intune sync timing reference ([Microsoft Learn — Common ways to use Intune](https://learn.microsoft.com/en-us/mem/intune/remote-actions/device-sync)); device health monitoring ([Microsoft Learn — Endpoint Analytics](https://learn.microsoft.com/en-us/mem/analytics/overview)).*
