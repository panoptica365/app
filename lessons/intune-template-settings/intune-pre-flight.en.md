---
title: "Before you touch an Intune template — the pre-flight checklist"
subtitle: "What to verify before deploying any Intune template: platform coverage, template-type families, and the assignment-loss risk."
icon: "clipboard-check"
last_updated: 2026-05-29
---

# Before you touch an Intune template — the pre-flight checklist

An MSP technician we know once tested a new Intune Configuration Profile by deploying it to a single test device, confirming it worked, and then bulk-deploying it to all 47 of their managed customer tenants over the next hour. By the end of the next day, eight customer tenants had reported assignment-related issues — the bulk deployment had triggered Intune's delete-and-recreate behaviour, which silently dropped the per-tenant exclusion groups those customers had configured. Devices that were supposed to be excluded from the policy were now in scope. Devices that had been carefully exempted from a specific compliance check were suddenly failing it.

The technician had done everything right by the standards of CA-template deployment. But Intune is not CA. The pre-flight discipline for Intune templates is different.

This lesson is the pre-flight you run before deploying any Intune template in card 4. It's distinct from the CA pre-flight in card 3 because Intune's failure modes are different — and because Intune has historical baggage CA doesn't carry.

## Why Intune deserves its own pre-flight

Three structural differences between Intune and CA that matter for deployment:

**Intune is platform-specific.** A CA policy applies to "all cloud apps" or "Exchange Online" — abstract universal targets. An Intune profile applies to Windows 10/11, or to iOS, or to Android Enterprise, or to macOS. The same template can't span platforms. Deploying without confirming the customer actually has devices on that platform produces a policy with no targets — silent, harmless, but also doing nothing.

**Intune has three different template-type families in active use.** Microsoft has shipped three generations of Intune policy infrastructure and never fully retired the older ones. In the Panoptica365 library you'll see all three:

- **Settings Catalog** (`configurationPolicies`) — the modern, granular settings interface. Most of the Panoptica365 Windows templates use this: ASR Rules, Block Microsoft Consumer Accounts, Block mshta.exe, Defender Settings (Windows + macOS), Firewall Settings, Security Baseline. This is what new Microsoft documentation uses.
- **Intents / Endpoint Security templates** (`intents`) — the older endpoint-security template style. The Panoptica365 Account Protection Settings template uses this. Microsoft hasn't deprecated it; it still exists alongside Settings Catalog. The Intune portal renders it differently than Settings Catalog policies.
- **Device Configurations** (`deviceConfigurations`) — the oldest style. The BitLocker Settings and Windows Health Monitoring templates use this. The UI for these in the Intune portal sits in a separate blade from the other two.

When an operator opens the Intune portal looking for a deployed Panoptica365 template, the template may be in any of three different sections of the UI. The template lives in whichever section matches its underlying type. There's no Panoptica365-doctored unification — Microsoft chose the structure, and the templates follow it.

**Intune deployments don't have a clean "Report-only" mode.** CA has Report-only as a first-class state. Intune doesn't. The closest equivalents are:

- *Audit mode* for ASR rules (a per-rule choice between Audit, Block, or Warn — covered in lesson 7).
- *Compliance policy in Report-only assignment* (you can deploy a compliance policy to a small pilot group first, evaluate, then expand assignment).
- *Configuration profile deployed to a small pilot group* (same pattern — deploy to a few devices, verify, expand).

None of these is exactly like CA's Report-only. The operator has to use pilot-group deployment as their dry-run, not a policy-level toggle.

## The five pre-flight steps

### 1. Inventory devices by platform and by management state

Before you deploy any Intune template, pull the device inventory. You need to know:

- **How many devices on each platform?** The Panoptica365 library is Windows-heavy (10 of the 14 templates are Windows-only) and that matches the SMB reality — most managed devices are Windows workstations. If a customer has zero Windows devices, half of card 4's templates are irrelevant. If they have all Windows except one stray Mac, the macOS templates target one device.
- **How many devices in each management state?** Devices can be Intune-managed (fully enrolled MDM), Entra-registered (lighter — known to Entra but not managed), or unenrolled (BYOD with no MDM presence). Templates apply to MDM-enrolled devices; unenrolled devices ignore the deployment entirely.
- **What is the BYOD mix?** Most SMB tenants you'll work with are heavily BYOD on mobile — users use their personal iPhones and Android devices. Those devices are typically not enrolled in MDM at all. The Panoptica365 mobile compliance templates assume MDM enrolment; without it, they don't apply. Setting customer expectations on "we don't manage personal mobile devices through this template" is important.

You'll pull this data from the Intune portal directly today — Panoptica365 surfaces the device list and OS breakdown on the customer dashboard, but the deeper inventory work (management state per device, BYOD vs corp-owned, enrolment age) happens in Microsoft's console.

### 2. Confirm the compliance loop is wired

Card 1 lesson 3 covered the compliance loop: Intune evaluates device state → writes compliance status to the Entra device record → Conditional Access reads that status at sign-in. If the loop is broken anywhere, the compliance signal is useless even when the Intune template deploys correctly.

Common breakages:

- **Device not yet synced.** Newly-enrolled devices can take 1–8 hours to complete their first compliance evaluation cycle. During that window, they show as "Not yet evaluated" in the compliance state. CA treats "Not yet evaluated" differently depending on policy configuration — sometimes as non-compliant, sometimes as inconclusive.
- **Compliance evaluation cadence too slow.** The default Intune check-in interval is every 8 hours for Windows. A device that becomes non-compliant at noon may still show compliant in the Entra record at 4 PM because the check-in hasn't happened yet.
- **Entra device registration broken.** If the device is enrolled in Intune but its Entra device object is in a bad state (orphaned, duplicated, broken sync from on-prem AD in hybrid environments), the compliance signal can't write back to Entra. Common in tenants that have grown through acquisitions or had AD Connect issues.

Before deploying a compliance template, verify the loop is working on a known-good test device. If the loop is broken, fix the loop before deploying — otherwise the templates produce false "compliant" or "non-compliant" states.

### 3. Choose the right assignment scope

Intune templates support several assignment models:

- **All devices.** Applies to every Intune-enrolled device.
- **All users.** Applies to devices owned by any user in the tenant.
- **Specific group (include).** Applies only to devices/users in the named group.
- **Specific group (exclude).** Applies to everyone except devices/users in the named group.

Most Panoptica365 templates ship with "All devices" or "All users" as the assignment default. That's the right choice for foundational hardening. The exception is when the customer has specific device categories that need to be excluded — kiosk devices, lab workstations, point-of-sale terminals — which usually live in their own Entra group and get excluded from the standard templates.

Common mistake: an operator includes the customer's break-glass admin account in the "All users" scope without intending to. The break-glass admin's device gets the same Intune configuration as everyone else, which may include restrictions the break-glass workflow depends on bypassing. Card 3 lesson 1's break-glass discipline applies here too: exclude the break-glass account from any device-management-state-affecting Intune templates.

### 4. Plan the pilot-group deployment

Since Intune doesn't have CA's Report-only mode, the operator's dry-run is a pilot-group deployment. The standard cadence:

1. **Day 0** — deploy the template assigned to a pilot group (typically 1–3 known-good test devices, or the IT team's own devices).
2. **Days 1–3** — verify the template deployed successfully to the pilot devices. Check the Intune portal for deployment success counts. Spot-check a pilot device to confirm the expected settings are actually applied (sometimes settings deploy successfully according to the portal but don't apply on the device — sync timing, conflicting policies).
3. **Days 3–7** — verify the customer experience on pilot devices. Did anything break? Are users complaining? Are any business apps affected?
4. **Day 7** — expand assignment from pilot group to full scope.

This window is longer for templates that change user experience (Security Baseline, ASR Rules, BitLocker) and shorter for templates that are pure-monitoring (Compliance policies, Windows Health Monitoring).

### 5. Document what you expect and how you'll verify

Before deployment, write down (in the ticket, in the change log, somewhere):

- What this template does at a customer level.
- Which devices it applies to.
- What you expect to see in the Intune portal 24 hours after deployment.
- What success looks like on a pilot device (specific Registry values, specific UI behaviour, specific compliance state).
- What to do if it breaks.

Panoptica365 records the deployment event automatically in the Tenant Change Log. The operator's job is to make the *expected outcome* part of the record, not just the deployment event itself. Future operators reading the audit trail need to know what should have happened, not just what was deployed.

## The assignment-loss gotcha — explicitly named

This is the failure mode the opening story described. It deserves explicit naming because it's specific to Intune and operators get bitten by it repeatedly.

When you update an existing Intune template (change a setting, modify a configuration), the deployment mechanism in some Intune template types is *delete-and-recreate* rather than in-place update. Specifically:

- **Settings Catalog policies (most templates):** in-place update. Safe. The policy ID stays the same; assignments are preserved.
- **Device Configurations (BitLocker, Health Monitoring):** also typically in-place update.
- **Intents / Endpoint Security templates (Account Protection):** *delete-and-recreate.* The old policy is removed and a new one created. Any per-tenant assignment exclusions configured against the old policy ID are not transferred to the new one — they're silently lost.

The operator's discipline for working around this:

- **Before updating an Intents-style template, capture the current assignments per tenant** by opening each customer's Intune portal and noting the assignment + exclusion groups on the relevant policy.
- **After the update, verify assignments are still correct on each tenant** — again, per-customer in the Intune portal.
- **If any are missing, restore them manually.**

This is annoying and genuinely tedious across many tenants. It's a Microsoft-imposed constraint at the API layer — until Microsoft replaces the delete-recreate behaviour with a reliable in-place update for Intents-style templates (which they've been working on slowly), the manual assignment-replay step is the only safe path.

## What this means for the operator

Three takeaways.

**Intune is more error-prone at deployment than CA.** The platform-specificity, the three template-type families, the assignment-loss gotcha, the absence of a Report-only mode — all of these increase the failure surface. Treat Intune deployments with more pre-flight discipline than CA deployments, not less.

**The pilot-group deployment is the operator's dry-run.** Use it. Skipping it is the same kind of mistake as skipping CA's Report-only mode — except the consequences land on user devices rather than on the cloud sign-in path. Easier to recover from a CA mis-deployment than from an Intune mis-deployment that pushed a bad configuration to 500 endpoints.

**Document the expected outcome, not just the action.** Panoptica365's audit trail captures the deployment event automatically. The operator captures the expected outcome and the verification steps. Future operators need both to operate the customer's Intune posture safely.

## What's next

The rest of card 4 walks through each Panoptica365 Intune template:

- **Lesson 2: Compliance policies** — Windows, iOS, Android, macOS combined.
- **Lesson 3: The Security Baseline** — the 60KB curated Windows hardening bundle.
- **Lesson 4: BitLocker Settings** — disk encryption posture.
- **Lesson 5: Defender for Endpoint (Win + Mac)** — antivirus / EDR configuration.
- **Lesson 6: Firewall Settings (Windows)** — host firewall.
- **Lesson 7: ASR Rules + Block mshta.exe** — attack surface reduction.
- **Lesson 8: Account Protection + Block MSA** — Windows Hello, Credential Guard, MSA block.
- **Lesson 9: The compliance loop in production** — drift detection and signal flow.
- **Lesson 10: Importing your own Intune templates** — customisation workflow.
- **Lesson 11: Operating Intune at scale** — drift, exclusions, lifecycle.

Each lesson assumes you've done the pre-flight above. The lessons themselves don't repeat the checklist. They get straight to *what each template does and how to roll it out*.

For now: pre-flight is the inoculation. Intune deployments without it are how customer devices end up misconfigured at 4 PM on a Friday.

---

*Sources for the data points in this lesson — Microsoft Learn on Intune compliance evaluation cadence ([Microsoft Learn — Compliance policies](https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started)); Microsoft Learn on the three Intune policy types ([Microsoft Learn — Settings Catalog vs Templates](https://learn.microsoft.com/en-us/mem/intune/configuration/settings-catalog)); Intune assignment behaviour reference ([Microsoft Learn — Assign user and device profiles](https://learn.microsoft.com/en-us/mem/intune/configuration/device-profile-assign)).*
