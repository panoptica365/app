---
title: "The Security Baseline — your curated Windows hardening bundle"
subtitle: "98 curated Windows hardening settings in one Configuration Profile — an experienced MSP's opinionated baseline, not Microsoft's official one."
icon: "shield-check"
last_updated: 2026-05-29
---

# The Security Baseline — your curated Windows hardening bundle

The Panoptica365 Security Baseline template is the biggest single artefact in the Intune library — about 98 individual settings packaged into one Configuration Profile. It is not Microsoft's official Windows Security Baseline. That distinction matters and we'll get to it. What it is, instead, is a curated bundle of Windows hardening settings collected over years from Microsoft Learn pages, MVP blogs, security researchers' writeups, and real-world hardening lessons learned across customer deployments. Think of it as "the Windows hardening posture an experienced MSP would recommend if you asked them to pick the settings that matter and skip the ones that don't."

This lesson walks through what's in it, how to think about it when you deploy it, and how to talk about it with customers who ask "is this the Microsoft Security Baseline?"

## What it is, plainly

The template:

- Applies to **Windows 10 / Windows 11** devices only (`platforms: windows10`).
- Uses the **Settings Catalog** template type (`configurationPolicies`), which means it lives in the Intune portal's Settings Catalog section, not the legacy templates section.
- Configures **about 98 distinct settings**, organised across roughly 20 setting categories.
- Touches both **device-scope** and **user-scope** policies — meaning it configures some things at the machine level and some things at the per-user level (e.g., AutoPlay restrictions apply per-user; security options apply to the device).

The settings span: local security policies, account behaviour, device lock, AutoPlay, Wi-Fi behaviour, PowerShell, Remote Desktop Services, Remote Management, web threat defense (SmartScreen integration), Chrome Remote Desktop restrictions, MS Security Guide settings, power options, AdmX-migrated GPO settings, and Microsoft Edge configurations.

What this template *does not* configure:

- BitLocker (separate template — lesson 4).
- Microsoft Defender Antivirus settings (separate template — lesson 5).
- Windows Defender Firewall (separate template — lesson 6).
- ASR rules (separate template — lesson 7).
- Windows Hello / Credential Guard (separate template — lesson 8).
- Windows Update for Business (not in the library — handled by the MSP's RMM tool).

The Security Baseline complements those other templates rather than overlapping with them. Where a setting could plausibly live in either the Security Baseline or a dedicated template (e.g., some Defender-adjacent options), the Panoptica365 library puts it in the dedicated template — keeping the Security Baseline as the "everything else" hardening bundle.

## It is not Microsoft's official Windows Security Baseline

This needs explicit framing because the template name invites confusion. Microsoft ships its own **Windows Security Baselines** — formal, documented, opinionated settings packages that Microsoft updates with each major Windows release. They're published in the Intune portal under Endpoint Security → Security baselines. When you create one of those, Microsoft applies their own curated set of settings.

The **Panoptica365 Security Baseline template** is *not* one of those. It's a separate, MSP-curated artefact that:

- Was assembled by hand based on MVP guidance, MS Learn articles, security blog posts, and real-world experience.
- Updates on the MSP's schedule, not Microsoft's.
- May or may not align with Microsoft's official baseline for any given setting.
- Lives as a Settings Catalog template, not as a Microsoft-shipped baseline.

When a customer's CISO asks "is this aligned with Microsoft's Windows Security Baseline?", the honest answer is: *not directly. This is an MSP-curated baseline informed by Microsoft's guidance but separately maintained. The intent is the same — harden Windows — but the specific settings are chosen for SMB operability rather than enterprise compliance.*

The Microsoft baselines are aimed at large enterprises with dedicated security teams. They're sometimes too restrictive for SMB scenarios — they assume specific authentication infrastructure, specific patch cadences, specific endpoint management maturity. The Panoptica365 Security Baseline is calibrated for the SMB context: aggressive enough to actually improve posture, lenient enough not to break common SMB workflows.

If a customer specifically needs Microsoft's official Windows Security Baseline for compliance reasons (e.g., a contract that names it explicitly), they should deploy that *alongside* this template. The two can coexist — Microsoft's baseline takes precedence where settings conflict, and many settings won't conflict at all.

## What's actually in it — the major categories

The 98 settings group into about 20 categories. The biggest ones:

**Local Policies / Security Options (11 settings).** Windows local security policy hardening — the things you'd configure in `secpol.msc` on a domain-joined machine, here delivered via MDM. Examples: minimum NTLM session security, smart card removal behaviour, system anonymous SID enumeration restriction, LSA protection.

**Microsoft Edge configuration (18 settings — 10 device + 8 user).** Edge browser hardening: site isolation, password manager behaviour, autofill restrictions, SmartScreen integration, download protection, sleeping tabs behaviour, profile creation restrictions.

**Device Lock (6 settings).** Screen lock policy: time before lock, lock screen behaviour, picture password disabling, force lock on inactivity.

**Chrome Remote Desktop / Chrome Remote Access (8 settings — 4 device + 4 user).** Specifically restricts Google's Chrome Remote Desktop and related Chrome remote-access features. This is a deliberate hardening move — Chrome Remote Desktop is a legitimate-looking remote access vector that attackers abuse, and most SMB environments have no business case for users running it. Worth knowing this is in here; some customers' IT folks legitimately use it and will need an exception.

**MS Security Guide (4 settings).** Microsoft's older "Security Guide" GPO recommendations — the ones from the SCM (Security Compliance Manager) days, still relevant. Things like SMB hardening, AppLocker prep, kernel mode authentication.

**AdmX (10 settings — 6 user + 4 device).** Settings migrated from traditional Group Policy ADMX templates, delivered through Intune's ADMX support. Mostly screensaver enforcement, lockscreen behaviour, and other GPO-derived hardening.

**AutoPlay (4 settings).** Disable AutoPlay/AutoRun for all media. Closes a classic malware delivery vector — USB stick with autorun payload.

**Web Threat Defense (3 settings).** SmartScreen-adjacent controls — checking downloaded files against threat intelligence, blocking unsafe phishing sites, controlling SmartScreen prompts.

**MSS Legacy (2 settings).** Older "Microsoft Solutions for Security" hardening — IP routing restriction, NetBIOS name release controls. Relevant for older Windows hardening practices.

**Power (2 settings).** Power management hardening — typically blocking sleep on AC power for desktops, blocking wake-on-LAN unless explicitly needed.

**Remote Desktop Services / Remote Management (4 settings).** RDP hardening — restrict remote connections, enable NLA (Network Level Authentication) if not already enforced, disable some legacy RPC behaviours.

**Wi-Fi (2 settings).** Block automatic connection to open networks, restrict Wi-Fi profile sharing.

**Windows PowerShell (2 settings).** PowerShell script block logging and module logging — turns on the detailed logging that's used for incident response. Doesn't restrict PowerShell itself; just makes it auditable.

**Connectivity (2 settings).** Internet Connection Sharing restrictions, Network Bridge restrictions.

There are more individual settings beyond these categories, but the above covers most of the bulk.

## The opinionated choices to know about

Three settings in this baseline that are worth knowing about because they affect real customer workflows:

**Chrome Remote Desktop is blocked.** This catches some IT teams off-guard. Chrome Remote Desktop is legitimately useful for some remote-access scenarios and is widely used by small companies who don't pay for a proper RMM tool. Blocking it via this baseline means those workflows stop working. If the customer has a real Chrome Remote Desktop use case, they need an exception. (The alternative — leaving Chrome Remote Desktop unrestricted — opens an attack vector that bypasses the MSP's RMM telemetry.)

**Wi-Fi auto-connect to open networks is blocked.** Standard hardening. Some users will be annoyed by this at coffee shops. Document it in the onboarding communication so it's not a surprise.

**PowerShell script block logging is enabled.** This is logging, not restriction — but it means *every PowerShell command run on the device gets logged to the Windows event log*. That's a privacy implication for power users who might prefer their PowerShell history not be recorded. It's the right call for security; it's worth knowing so you can answer the question if asked.

The other 90+ settings are mostly invisible to users in normal operation. They harden things that the user shouldn't be interacting with directly (system policy, network behaviour, browser internal defaults).

## Rollout

The Security Baseline is the highest-impact-per-template deployment in the library because it touches so many separate Windows behaviours. Run the pilot-group deployment from lesson 1 with more care than for the smaller templates.

1. **Day 0** — deploy to a pilot group of 3–5 known-good test devices (IT team devices, a willing power user, maybe one general-population device).
2. **Days 1–7** — verify the deployment succeeded (Intune portal shows success counts), and *use* the pilot devices for normal work. Look for:
   - Anything that broke. Specific business apps that no longer work, Edge behaviours that changed in user-visible ways, remote-access tools that stopped working (Chrome Remote Desktop is the classic catch).
   - PowerShell scripts that legitimately do unusual things — block-mode logging shouldn't break them, but if a legitimate script does something the baseline blocks, you'll see errors.
   - Power-user complaints. Power users notice baseline deployments first.
3. **Days 7–14** — extend to a wider pilot if the first round was clean. A full department or a subset of the customer's users.
4. **Day 14–21** — full deployment if the wider pilot is clean.

The total rollout window is 2–3 weeks, longer than most templates because the surface area is so wide. Trying to rush this template is how an MSP ends up with a Friday-evening "the Security Baseline broke everyone's [thing]" support call.

## What to monitor after enforcement

**Deployment success rate.** The Intune portal shows per-device success/failure for the Security Baseline. Healthy is 98%+ success. Devices showing failures need investigation — usually a conflict with another policy, a non-standard Windows version, or a device that's been offline for too long.

**Settings reported as not applied.** Even on devices showing overall success, individual settings can fail to apply (incompatibility with installed software, locked Registry keys, etc.). Spot-check pilot devices to confirm specific settings are actually in effect.

**User complaints in the first 30 days.** This is when the Chrome Remote Desktop and Wi-Fi-auto-connect cases surface. Document each one. Decide per case: exception via exclusion, or workflow change for the customer.

**Drift on the template itself.** Panoptica365's drift detector applies here. If the deployed template diverges from the bundled Security Baseline, that's drift to investigate. A common cause: a customer's other admin adjusted a specific setting that broke for them, and the divergence didn't propagate back to your reference.

## When to customise

The Security Baseline is the template most likely to need per-customer customisation. Common reasons:

- A customer's regulatory framework requires specific settings the baseline doesn't include or sets differently.
- A customer's business application requires a baseline-blocked behaviour (a custom Chrome Remote Desktop deployment, a specific PowerShell pattern).
- A customer is on a Windows variant (Server, LTSC) where some baseline settings don't apply.
- A customer's IT maturity has grown — they want stricter settings than the SMB-tuned baseline provides.

The right customisation workflow is in lesson 10: export the baseline from a tenant where you've made the customisation, generalise the references, import as a new template, deploy across applicable customers. Don't edit the bundled template directly — that drifts your reference away from the shipped Panoptica365 baseline and makes future updates messy.

## What this means for the operator

Three takeaways.

**The Security Baseline is the biggest single deployment in card 4. Treat it accordingly.** Two- to three-week rollout window, pilot-group discipline, monitor for 30 days. Don't bulk-deploy to all customers in one session.

**Be explicit with customers that this is MSP-curated, not Microsoft-official.** When the question comes up (and it will), the right answer is "this is our hardening baseline informed by Microsoft's guidance, not Microsoft's official baseline. They can coexist if you need both." Document this in the customer's onboarding materials.

**Know the three opinionated choices that affect users.** Chrome Remote Desktop blocked, Wi-Fi auto-connect blocked, PowerShell logging enabled. These will surface as questions; have the answers ready. The other 90+ settings rarely produce user-visible effects.

## What's next

- **Lesson 4: BitLocker Settings.** Disk encryption — the configuration template that delivers what the Windows compliance policy doesn't require but the hardening posture does demand.
- **Lesson 5: Defender for Endpoint (Win + Mac).** The antivirus / EDR configuration delivered separately from the Security Baseline.

For now: the Security Baseline is the foundation of Windows-side hardening in the Panoptica365 library. Deploy it carefully; monitor it for the first month; customise per customer when their reality diverges from the SMB defaults.

---

*Sources for the data points in this lesson — Microsoft Learn on Windows Security Baselines (the official ones) ([Microsoft Learn — Windows security baselines](https://learn.microsoft.com/en-us/windows/security/operating-system-security/device-management/windows-security-configuration-framework/windows-security-baselines)); Settings Catalog reference ([Microsoft Learn — Settings catalog](https://learn.microsoft.com/en-us/mem/intune/configuration/settings-catalog)); Microsoft Edge configuration via Intune ([Microsoft Learn — Configure Edge via Intune](https://learn.microsoft.com/en-us/deployedge/configure-edge-with-intune)); ADMX-backed policy delivery ([Microsoft Learn — ADMX-backed policies](https://learn.microsoft.com/en-us/mem/intune/configuration/administrative-templates-windows)).*
