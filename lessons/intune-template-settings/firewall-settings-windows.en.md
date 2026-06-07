---
title: "Firewall Settings — Windows network defence"
subtitle: "51 settings across Domain, Private, and Public profiles — ensuring Windows Defender Firewall is on, logging, and tight in every network context."
icon: "flame"
last_updated: 2026-05-29
---

# Firewall Settings — Windows network defence

If Defender for Endpoint is the layer that watches files and processes, the Windows Defender Firewall is the layer that watches network connections. The two complement each other: Defender catches malware that's already on the device; the Firewall stops malware from reaching the device in the first place — or stops compromised software on the device from reaching its command-and-control infrastructure.

The Panoptica365 Firewall Settings Windows template is the largest non-Security-Baseline configuration in the library at 34KB and 51 distinct settings. It configures Windows Defender Firewall across all three network profiles (Domain, Private, Public) plus global settings, ensuring the firewall is on, logging, and using sensible defaults.

This lesson walks through what gets configured, the three-profile model that makes Windows Defender Firewall confusing, and the operational realities of running host firewalls in production.

## The three-profile model — what makes this template look big

Windows Defender Firewall has the unusual design of maintaining three separate firewall profiles, each applied based on the network the device is connected to:

- **Domain profile** — applied when the device is on a network that contains a domain controller it's joined to. Typically the corporate office network.
- **Private profile** — applied when the device is on a network the user has marked as Private (home network, trusted small office).
- **Public profile** — applied when the device is on a network marked as Public (coffee shop, airport, hotel). The default profile for any unrecognised network.

Each profile has roughly the same set of configurable settings: enable/disable, default inbound action, default outbound action, stealth mode, logging behaviour, log file location, log size, allow local policy merge. So the template's 51 settings is mostly *17 settings × 3 profiles* with a handful of global settings layered on top.

The reason all three profiles need explicit configuration is that the Public profile in particular needs to be tighter than the Domain profile. A device on the corporate network has trusted neighbours and trusted infrastructure; a device on a coffee shop network is sharing the LAN with strangers. The default action for inbound traffic should differ accordingly.

## What the template configures, by profile

For **each of the three profiles**, the template sets:

- **`enablefirewall`** — Firewall enabled on this profile.
- **`defaultinboundaction`** — Block inbound traffic by default (the secure baseline; specific allow rules layer on top).
- **`defaultoutboundaction`** — Allow outbound traffic by default (the typical posture for client devices; outbound block rules layer on top).
- **`disablestealthmode`** — Stealth mode enabled (no, the setting is named confusingly — `disablestealthmode: false` means stealth mode IS active). Stealth mode means the device doesn't respond to network probes (port scans, ICMP echo, etc.), which makes it less discoverable to attackers on the same network segment.
- **`disablestealthmodeipsecsecuredpacketexemption`** — IPSec-secured packets are exempt from stealth mode (so IPSec connections still work even with stealth on).
- **`disableunicastresponsestomulticastbroadcast`** — Disables unicast responses to multicast/broadcast — closes a small information-disclosure vector.
- **`disableinboundnotifications`** — Don't show inbound-blocked notifications to users. This is the lenient choice; the strict version would notify users when something tried to reach them.
- **`enablelogdroppedpackets`** — Log packets dropped by the firewall. Important for incident response.
- **`enablelogsuccessconnections`** — Log successful connections. Heavy on disk but useful for forensics.
- **`enablelogignoredrules`** — Log rules that were configured but ignored (e.g., disabled rules that would have matched). Diagnostic.
- **`logfilepath`** — Where the log file goes (typically `%systemroot%\system32\logfiles\firewall\pfirewall.log` or similar).
- **`logmaxfilesize`** — Maximum size of the firewall log before it rotates.
- **`allowlocalpolicymerge`** — Whether locally-configured firewall rules can merge with the central policy. Typically `false` (the centrally-managed policy wins; users can't add their own rules).
- **`allowlocalipsecpolicymerge`** — Same, for IPSec policy.
- **`authappsallowuserprefmerge`** — Whether authorised applications can merge with user preferences. Typically `false`.
- **`globalportsallowuserprefmerge`** — Whether global port rules can merge with user preferences.

Across the three profiles, that's roughly 51 settings, with minor variations between Domain (more permissive — corporate network is trusted), Private (medium), and Public (strictest — coffee shop network is hostile).

## Global firewall settings

In addition to per-profile settings, the template configures a few global settings that affect all three profiles:

- **`crlcheck`** — Certificate Revocation List checking behaviour for firewall rule evaluation. Ensures revoked certs aren't accepted for authentication.
- **`disablestatefulftp`** — Stateful FTP filtering. Modern hardening — stateful FTP support introduces parsing complexity that's been exploited historically.
- **`presharedkeyencoding`** — Encoding for IPSec preshared keys (typically UTF-8).

These global settings are deliberate hardening choices that close historical attack vectors in the Windows firewall component itself.

## The opinionated choices to know

A handful of settings in this template that affect user experience or have specific security implications:

**Stealth mode enabled.** Device won't respond to network probes. Means standard network discovery (ping, port scans) won't see the device. Helps in hostile networks; mostly invisible to users; occasionally confuses network engineers trying to troubleshoot from another machine ("why doesn't this PC respond to ping?"). Document this if a customer's IT team relies on ping for monitoring.

**Inbound notifications disabled.** Users don't see "Windows Defender Firewall has blocked some features of this app" pop-ups. This is friendlier — the pop-ups are annoying and most users click through them without understanding. The trade-off: a user installing a legitimate app that needs an inbound exception won't be prompted to add one; the operator will need to add the exception centrally. For SMB scenarios, this is usually the right trade-off (operator-managed exceptions > user-managed exceptions).

**Local policy merge disabled.** Users (even those with local admin) can't add their own firewall rules that conflict with the central policy. This is the secure choice but it occasionally surprises power users who used to be able to allow their own apps through. The mitigation is the same as above — add legitimate exceptions centrally as they come up.

**Logging is verbose.** `enablelogdroppedpackets`, `enablelogsuccessconnections`, and `enablelogignoredrules` are all on. This generates substantial firewall log activity on the device. The log file rotates at the configured max size, so it doesn't fill the disk indefinitely, but devices doing high-volume legitimate network activity will see meaningful log writes. The benefit is incident response — when something does go wrong, the firewall log is one of the most useful forensic artefacts available.

## What can break

Firewall deployment can break things in ways that Defender deployment rarely does, because the firewall sits in the network path of every connection:

**Legitimate inbound services.** Anything on the device that listens for inbound connections (a development web server on localhost, a network-shared printer driver, a remote management tool, a legacy line-of-business app that uses peer-to-peer connections) needs an explicit allow rule. Without one, the connection is blocked. The Panoptica365 template's `defaultinboundaction: block` makes this strict by design — but it means inbound use cases need exceptions.

**File and printer sharing.** Windows SMB file sharing relies on specific inbound rules. The template's defaults handle these correctly for standard configurations, but customers with non-standard SMB setups (specific older Samba servers, non-standard ports) may need adjustments.

**Custom network apps.** Industry-specific apps (medical imaging, CAD with shared license servers, manufacturing control systems) often have non-standard network behaviours. The template's strict defaults can break them. The fix is per-app firewall exceptions added to the deployed policy on a per-customer basis.

**Network discovery in non-domain environments.** A user trying to find a network printer on a Private profile network may struggle because stealth mode and inbound block by default make discovery harder. Usually fine with proper printer-installation procedures; can surface as a complaint in less mature customer environments.

## Rollout

Pilot-group deployment from lesson 1's pre-flight, with extra attention to network-dependent business workflows:

1. **Day 0** — deploy to 3–5 pilot devices. *Critical*: choose devices that exercise the customer's network workflows (file shares, printers, line-of-business apps with network components).
2. **Days 1–7** — verify deployment success in the Intune portal. Test every network-dependent workflow on the pilot devices: print, file share access, business apps, VPN, remote desktop. *Anything* network-related should be tested.
3. **Days 7–14** — observe pilot devices. The first week is when the obvious breakage surfaces; the second week is when the once-a-week and once-a-month workflows expose more subtle issues.
4. **Day 14** — broader deployment if pilot is clean.

For firewall changes specifically, the rollout window of 14 days is the minimum. A customer with monthly batch workflows or quarterly reports may need a 30-day window before you can confidently say "nothing broke."

## What to monitor after enforcement

**Firewall enabled per device per profile.** Should be 100% enabled across all three profiles after deployment. Devices showing the firewall disabled on any profile are devices where the template failed to apply (uncommon) or where a local admin has disabled it (more common — investigate).

**Dropped packet logs.** The verbose logging means the firewall log is full of dropped-packet entries. Most are noise (Internet background scanning hitting the device). Real signals to watch for: bursts of dropped packets from a specific internal IP (could indicate compromised internal device probing), repeated drops from the same external source (could indicate a targeted scan), drops of legitimate-looking protocols (could indicate misconfigured app).

**User-reported workflow breakage.** Track every "X stopped working after the firewall deployment" complaint. Some are real breakage requiring per-app exceptions; some are coincidence; some are user-error. Document each one.

**Drift on the template.** Like other templates, the Firewall Settings template can drift if a customer's other admin modifies it. Drift can be dangerous here — broadening the inbound action default or disabling stealth mode would reduce security materially.

## The Block mshta.exe template is firewall-adjacent

The Panoptica365 library includes a separate template — Block mshta.exe outbound connections — that lives in the same `endpointSecurityFirewall` template family as the main Firewall Settings template. It's covered in lesson 7 (alongside ASR Rules) because conceptually it's an attack-surface-reduction rule rather than a general firewall configuration. Worth knowing: when an operator opens the Intune portal looking for firewall-related configurations, they'll see both the main Firewall Settings template and the Block mshta.exe template in the same list. They serve different purposes.

## What Panoptica365 sees

Two real things, and what isn't there.

**What Panoptica365 surfaces:**

- **Drift on the Firewall Settings template.** Same model as the rest: if a customer's deployed template diverges from the Panoptica365 reference — somebody opens the Intune console and disables stealth mode, opens an inbound block, drops the logging — drift detector fires and the operator can revert, reapply, or accept.
- **Defender XDR detections** (when Defender XDR ingestion is configured per card 1 lesson 4) — incidents that incorporate firewall-blocked connections in their context flow into the alert engine. This is not "firewall events"; it's higher-level Microsoft incidents that may reference firewall activity.

**What Panoptica365 does *not* surface:** per-device firewall enabled state, per-profile (Domain/Private/Public) status per device, raw firewall log events. None of that lives in the dashboard. The Intune compliance signal includes `activeFirewallRequired: true`, so a device with the firewall off rolls up into the overall compliant/non-compliant count — but you can't look at "which devices specifically have which profile off" from Panoptica365. That's an Intune-portal-and-Defender-console drill-down.

The firewall log file itself is a local Windows artefact that incident responders pull when investigating a specific device. Not ingested by Panoptica365 — for fleet-wide network defence telemetry, the visible surface is the Defender XDR alert pipeline.

## What this means for the operator

Three takeaways.

**Firewall deployment is the most likely template in card 4 to break something.** Anything that listens on the network or that lives in non-standard network behaviour can be affected. Plan for a 14–30 day rollout window with thorough workflow testing.

**The three-profile model is real and worth understanding.** When a user complains "the firewall is blocking [thing]," the first question is *which profile is active when this happens?* The same device behaves differently on the office Wi-Fi vs. the coffee shop Wi-Fi because the active profile changes.

**Stealth mode and inbound block defaults are the strict choices.** Document them with the customer. The strictness is the point — the alternative is the laissez-faire default that gave attackers easy network discovery for two decades.

## What's next

- **Lesson 7: ASR Rules + Block mshta.exe.** Attack surface reduction — the pre-emptive behaviour-block features that catch threats before they're delivered to disk.
- **Lesson 8: Account Protection + Block MSA.** Windows Hello for Business, Credential Guard, blocking personal MSA additions.

For now: the Firewall template is the network-layer companion to the Defender file-layer template. Together they constitute the active defence layer on Windows endpoints. Deploy with thorough workflow testing; tolerate the 14–30 day rollout; resist the temptation to weaken the strict defaults.

---

*Sources for the data points in this lesson — Microsoft Learn on Windows Defender Firewall configuration via Intune ([Microsoft Learn — Configure Windows Defender Firewall via Intune](https://learn.microsoft.com/en-us/mem/intune/protect/endpoint-security-firewall-policy)); Windows Defender Firewall profile model ([Microsoft Learn — Windows Defender Firewall with Advanced Security](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/windows-firewall-with-advanced-security)); Firewall logging reference ([Microsoft Learn — Firewall logging](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/configure-firewall-logging)).*
