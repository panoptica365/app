---
title: "Account Protection + Block Microsoft Consumer Accounts — credential hardening on the endpoint"
subtitle: "Windows Hello for Business, Credential Guard, and blocking personal Microsoft Accounts — making credentials harder to steal if the device is compromised."
icon: "user-lock"
last_updated: 2026-05-29
---

# Account Protection + Block Microsoft Consumer Accounts — credential hardening on the endpoint

Most of card 2's identity threats end at the moment the attacker has credentials. AiTM phishing captures the session cookie; credential stuffing succeeds with a reused password; OAuth consent phishing gets the user to grant access. The defence in each case has been *don't let the attacker get the credential* (phishing-resistant MFA), *don't let the credential be stolen* (passkeys, certificate-based auth), or *don't let a stolen credential be useful* (Token Protection, Conditional Access).

There's a complementary defence that lives on the endpoint itself: make the credentials *harder to steal in the first place* if the device is compromised. That's what this lesson's two templates do.

The Account Protection Settings template configures Windows Hello for Business (passkey-style biometric or PIN authentication tied to the device's TPM) and Credential Guard (a virtualization-based isolation layer that protects credentials in memory from extraction by malware).

The Block Microsoft Consumer Accounts template prevents users from adding personal Microsoft Accounts (the consumer Outlook.com / Hotmail / Live.com kind) to corporate Windows devices, which closes a backdoor where a user might accidentally — or deliberately — sign their device into a personal cloud identity alongside the corporate one.

This lesson covers both.

## Account Protection Settings — what it configures

The template uses the older **Intents** template type (`policyType: intents`) with the Microsoft endpoint-security template ID `0f2b5d70-d4e9-4156-8c16-1397eb6c54a5`. That template ID corresponds to Microsoft's Account Protection endpoint-security policy family.

The settings (about 15 of them) cluster into three areas:

### Windows Hello for Business — PIN policy

Windows Hello for Business (WHfB) is Microsoft's passwordless authentication mechanism on Windows. Instead of typing a password to sign in, the user authenticates via PIN (backed by the TPM), biometrics (face or fingerprint, backed by Windows Hello hardware), or a security key. The credential is stored cryptographically on the device's TPM, so it can't be extracted by malware reading memory.

The PIN policy settings:

- **Minimum PIN length: 6** (the template's choice — Microsoft's default minimum is 4; longer is stronger but more friction).
- **Maximum PIN length: 127** (effectively unlimited).
- **Previous PIN block count: 24** — can't reuse the last 24 PINs.
- **PIN expiration in days: 0** — no PIN expiration. This is the recommended modern setting; forced PIN rotation creates worse outcomes (users pick weaker PINs they can remember).
- **PIN uppercase characters / lowercase characters / special characters: notConfigured** — no character requirements beyond minimum length. PINs are device-local and TPM-backed; complexity matters less than length.
- **PIN recovery enabled: true** — users can recover a lost PIN via the configured recovery method.

### Windows Hello unlock behaviour

- **Unlock with biometrics: true** — face or fingerprint unlock allowed alongside PIN.
- **Enhanced anti-spoofing: true** — biometric unlock uses anti-spoofing detection (prevents fooling face recognition with a photo).
- **Use security key for sign-in: false** — FIDO2 security keys for sign-in are not the default. This is set this way because not every customer has issued FIDO2 keys; tenants that have done so can override this per-tenant.
- **Use certificates for on-prem auth: false** — certificate-based on-prem auth not the default for this template.
- **Windows Hello for Business required: false** — WHfB is *available* but not *required*. Users can still sign in with a password if they prefer. The combination of the WHfB infrastructure being present and the user choosing it is the typical adoption path.
- **Security device required: false** — TPM not required for WHfB. (In practice, almost every Windows device has a TPM; this setting is permissive.)

### Credential Guard

- **Device Guard / Credential Guard: enableWithoutUEFILock** — Credential Guard is enabled, but the UEFI lock that would prevent disabling Credential Guard from outside the OS is not enforced.

Credential Guard is the security feature that matters most in this template. It uses Windows virtualisation (Hyper-V isolation) to isolate the LSASS process — the part of Windows that stores hashed credentials in memory. With Credential Guard active, malware running on the device (even with elevated privileges) cannot extract credentials from LSASS memory — the credentials are in a hardware-isolated container that the rest of the OS can't reach.

This is the defence against tools like Mimikatz, which dump LSASS memory to extract NTLM hashes and Kerberos tickets that can be replayed to attack other systems. The ASR rule "Block credential stealing from LSASS" (lesson 7) catches Mimikatz at the behaviour level; Credential Guard prevents the underlying attack from succeeding even if the behavioural detection were bypassed.

The "enable without UEFI lock" choice trades a small amount of security for a large amount of operational flexibility. The UEFI lock would make Credential Guard impossible to disable without physically reflashing the device's firmware. That's the maximum-security setting but it's brittle — if a problem develops (driver compatibility, troubleshooting need), the operator can't undo it via Intune. The non-UEFI-lock variant gives MSPs the ability to disable Credential Guard via policy when needed, at the cost of allowing the same disable path to a sophisticated attacker who's already compromised the device.

## Block Microsoft Consumer Accounts — what it configures

The template uses the modern Settings Catalog template type. Its job is narrow and deliberate: prevent users from adding personal Microsoft Accounts (Outlook.com / Hotmail / Live.com / Xbox / personal OneDrive) to a corporate Windows device, while leaving work/school account authentication via the Web Account Manager (WAM) — the mechanism Microsoft 365 apps use to sign in — fully intact.

The distinction matters because the "block Microsoft accounts" policy in Windows is a single CSP that can be configured several ways, and the wrong value blocks too much. WAM uses Microsoft-account-style authentication flows for work/school accounts under the hood, so a heavy-handed setting that blocks all MSA-flavoured auth will also break Outlook, Teams, and other Office app sign-ins. The template is tuned to block only personal MSA addition, leaving the work/school authentication path open.

The template's actual configuration:

- **Allow Microsoft Accounts:** configured to block personal MSA addition while permitting work/school account authentication via WAM.
- A few related Account Manager settings tuned consistently with that intent.

The intent: a managed corporate device should sign in to corporate identities only. Users shouldn't be adding their personal Outlook.com account, their personal OneDrive, their gaming-related MSA to the device. The reasons:

- **Data leakage risk.** A personal MSA configured on a corporate device can sync personal OneDrive folders that contain corporate documents. The corporate data is now in the personal cloud, outside MSP control.
- **Identity confusion.** Users with both corporate and personal MSAs on the same device frequently authenticate to the wrong identity, causing support tickets and occasionally exposing corporate data to personal cloud storage.
- **Phishing exposure.** A phishing email targeting the user's personal MSA, opened on the corporate device, can result in compromise that affects the corporate device even though the targeted identity is personal.
- **Compliance.** Several regulatory frameworks (including some interpretations of GDPR and CCPA) treat the mixing of corporate and personal data on the same device as a compliance issue.

The honest framing: blocking personal MSA addition is a meaningful security improvement with minimal user impact. Users who legitimately want their personal accounts available do that on their personal devices. Corporate devices are corporate.

## What can break

These templates are generally safer than the ASR Rules and Firewall templates, but they have specific gotchas:

**Windows Hello for Business adoption needs infrastructure.** Deploying the Account Protection template without WHfB infrastructure (the cloud Kerberos trust setup, the certificate authority configuration for on-prem hybrid scenarios, the device enrolment flow) means users can't actually use WHfB. They'll sign in with passwords as they always have, and the WHfB settings sit unused. This is benign but means the security benefit isn't realised. WHfB adoption is usually a separate project from this template's deployment.

**Credential Guard incompatibility.** A small number of legitimate apps don't work with Credential Guard active. Common culprits: older VPN clients, specific anti-malware products that hook LSASS, some certificate-based authentication tools. The fix is usually to update the affected software; the workaround is to disable Credential Guard for the specific user/device via an exclusion.

**Block MSA template breaking previously-configured MSAs.** Users who had personal MSAs configured before the template was deployed may see their personal accounts removed or become unable to refresh. Communicate this to the customer in advance — users with legitimate personal-account-on-corporate-device patterns will need to adjust their workflows.

**WHfB PIN reset friction.** Users who forget their PIN need a reset path. If the customer hasn't configured PIN recovery infrastructure (the recovery key storage, the user-facing reset UI), users get locked out. Verify the recovery path works before deploying.

## Rollout

Pilot-group deployment for both templates:

1. **Day 0** — deploy Account Protection and Block MSA to 3–5 pilot devices. Critical pilot device characteristic: at least one device with personal MSA already configured (to test the Block MSA behaviour on existing state) and at least one device where the user is likely to try WHfB (to verify the infrastructure works).
2. **Days 1–7** — verify deployment success in Intune. Spot-check pilot devices. Confirm Credential Guard shows active in `msinfo32.exe` (look for "Credential Guard" in System Summary — should show "Configured" and "Running"). Confirm Block MSA's effect — try adding a personal MSA on a pilot device; should fail with appropriate error.
3. **Days 7–14** — observe pilot device use. Watch for VPN issues (Credential Guard compatibility), authentication issues with niche software, user complaints about Block MSA.
4. **Day 14** — broader deployment if pilot is clean.

For the Block MSA template specifically, communicate to the customer's users *before* deployment. Users with personal MSAs on their corporate devices need to know what's about to change.

## What to monitor after enforcement

**Credential Guard active per device.** Should be 100% active on Windows 10/11 devices after deployment. Devices showing "Configured but not running" indicate hardware compatibility issues (rare; usually older virtualisation hardware) or a conflict with another product.

**WHfB enrolment rate.** Tracks how many users have actually adopted WHfB. The template makes WHfB *available*; user adoption is voluntary. Low adoption is normal in the first weeks; should climb over months as users discover the convenience.

**Authentication failures after deployment.** Watch for a spike in authentication-related help-desk tickets. Could be VPN incompatibility (Credential Guard), Block MSA confusion (users trying to sign in with personal MSA), or PIN reset issues.

**LSASS memory access events** (from Defender XDR ingestion, when configured per card 1 lesson 4). With Credential Guard active, the volume of attempted LSASS-memory-access events that get blocked should be near zero in normal operation. Any non-zero volume is interesting — either Credential Guard is doing its job against active malware, or a legitimate process is doing something that triggers the protection.

**Drift on either template.** Both templates can drift — an admin disabling Credential Guard for a specific device that had compatibility issues, an admin loosening Block MSA at a customer's request, etc.

## What Panoptica365 sees

Honestly: not much specifically about Account Protection. The dashboard does not have per-device Credential Guard state, per-user WHfB enrolment status, or a Block MSA deployment matrix. None of those exist in the product today, and per-device anything is outside Panoptica365's read model.

What Panoptica365 *does* surface that's relevant:

- **Drift on either template.** Account Protection and Block Microsoft Consumer Accounts are both watched by the drift detector. If an admin disables Credential Guard for a problem device, or loosens Block MSA at a customer's request, drift fires and the operator can revert, reapply, or accept.
- **Defender XDR detections.** When Defender XDR ingestion is configured (card 1 lesson 4), credential-attack-related incidents — LSASS access attempts, suspicious credential-extraction patterns — flow into the alert engine. If Credential Guard is doing its job, those incidents should be rare; a spike is interesting.

For per-device Credential Guard status, per-user WHfB enrolment, or per-device Block MSA verification, operators drill into the Intune device blade, the Entra device records, or the Defender for Endpoint portal. That split — Panoptica365 for alerts and drift, Microsoft consoles for per-device posture — is the consistent shape of the platform across all of card 4.

## What this means for the operator

Three takeaways.

**Credential Guard is the highest-leverage setting in this template.** Of the 15 Account Protection settings, the Credential Guard activation is the one that matters most. It defends against an entire class of credential-extraction attacks. Deploying without it leaves a major gap; deploying with it closes the gap with little operational cost.

**Block MSA is a quiet, high-value template.** Personal MSAs on corporate devices are a chronic source of data-leakage incidents and identity confusion. Blocking them addresses the issue at the configuration layer. The template is precisely tuned to block personal MSA addition while leaving the work/school WAM authentication path that M365 apps depend on fully intact — a narrower target than the default "Allow Microsoft Accounts" CSP would suggest, and the reason this template is worth treating as a curated configuration rather than a one-line policy flip.

**WHfB adoption is a longer-term motion.** This template makes WHfB *possible*. Getting users to actually use it (vs. continuing to type passwords) is a separate change-management exercise. Don't expect 100% WHfB adoption within a month of deployment; expect gradual uptake over six to twelve months.

## What's next

- **Lesson 9: The compliance loop in production.** How all these Intune templates surface as signals — what Panoptica365 watches, what drift means here.
- **Lesson 10: Importing your own Intune templates.** The customisation workflow.

For now: Account Protection + Block MSA together close the credential-side gap on Windows endpoints. Deploy both; verify Credential Guard activates; communicate the Block MSA change to users; track WHfB adoption over months.

---

*Sources for the data points in this lesson — Microsoft Learn on Windows Hello for Business ([Microsoft Learn — Windows Hello for Business](https://learn.microsoft.com/en-us/windows/security/identity-protection/hello-for-business/)); Credential Guard reference ([Microsoft Learn — Credential Guard](https://learn.microsoft.com/en-us/windows/security/identity-protection/credential-guard/)); Account Protection policy in endpoint security ([Microsoft Learn — Account Protection policies](https://learn.microsoft.com/en-us/mem/intune/protect/endpoint-security-account-protection-policy)); the Allow Microsoft Accounts policy CSP ([Microsoft Learn — Accounts CSP](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-accounts)); Web Account Manager and M365 ([Microsoft Learn — WAM and M365](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-acquire-token-wam)).*
