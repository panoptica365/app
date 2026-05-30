---
title: "Importing your own Intune templates — when the bundled library isn't enough"
subtitle: "How to import custom Intune templates into Panoptica365 and deploy them across customer tenants alongside the bundled library."
icon: "upload"
last_updated: 2026-05-29
---

# Importing your own Intune templates — when the bundled library isn't enough

The Panoptica365 Intune library ships 14 templates focused on Windows endpoint hardening, with compliance signals for iOS, Android, and macOS. That's deliberate and matches the SMB reality: most managed devices are Windows, mobile is mostly BYOD, macOS is a minority. For the typical SMB customer, the bundled library covers the security-critical configuration surface.

But "typical SMB" isn't every SMB. Some customers have:

- A heavy Android Enterprise fleet (logistics companies, field-service businesses) that needs configuration profiles beyond the compliance signal.
- A macOS-majority environment (creative agencies, software dev shops) that needs configuration profiles for FileVault, gatekeeper, software updates, app deployment.
- Industry-specific requirements that need bespoke configuration profiles — healthcare device kiosk modes, manufacturing-floor lockdown, retail point-of-sale hardening.
- Mature MSP-internal hardening templates that the senior IT lead has tuned over years and wants deployed across the entire customer base.
- Regulatory baselines (CIS, NIST, HIPAA-specific) that need to be deployed as Intune templates alongside the Panoptica365 library.

For all of these, the answer is the same: **import your own Intune templates** into Panoptica365's library, deploy them across customer tenants the same way the bundled templates deploy.

This lesson walks through that workflow — the parallel of card 3 lesson 8, adapted for Intune's specific quirks.

## When to import a custom Intune template

The same five scenarios that applied to CA templates apply here:

**1. Platform coverage the bundled library doesn't address.** Android Enterprise configuration profiles, iOS app configuration policies, macOS configuration profiles for FileVault and gatekeeper. These all live as exportable Intune templates in any tenant where they've been built; they can be lifted into Panoptica365.

**2. A custom hardening configuration built at one customer that should be available to others.** A senior engineer's brilliant Windows configuration for a specific industry vertical (healthcare imaging, legal document management, accounting firms) gets exported once, generalised, imported as a template, deployed across similar customers.

**3. Compliance-framework baselines.** CIS Microsoft 365 Foundations Benchmark mappings, NIST 800-171 controls, HIPAA-specific hardening. These exist as detailed configuration profiles that can be deployed via Intune. Build them once for a customer that needs them; import as a template; deploy to other customers in the same regulatory bucket.

**4. Response to a specific incident or near-miss.** After a customer experienced a credential-theft incident, you build a stricter set of configuration profiles. You'd like that hardening available for other customers in the same risk profile. Import is the mechanism.

**5. New threats requiring new configurations.** Microsoft announces a new attack technique; your security team builds an Intune configuration that addresses it; you need it deployed across thirty tenants. Build once, import once, deploy thirty times.

The pattern is identical to CA: a template exists somewhere, you want it to exist elsewhere, Panoptica365 makes the transfer tractable.

## How the import works — Intune specifics

The high-level workflow is straightforward and deliberately less magical than its CA cousin. Set expectations honestly: there is no automatic generalisation of tenant-specific references happening behind the scenes. What you export is approximately what you import.

**Step 1: Point Panoptica365 at a source tenant.** An MSP operator picks any tenant the platform has access to and pulls the Intune configuration via Microsoft Graph. The pull produces a structured JSON representation of the source tenant's Configuration Policies, Compliance Policies, Configuration Profiles, and Endpoint Security templates — the same shape as the bundled `Panoptica365 - ...` templates, which were themselves built by exporting from a source tenant, cleaning up tenant-specific references, and bundling the result.

**Step 2: Choose what to import as a template.** From the list of pulled policies, the operator picks the specific ones to register as Panoptica365 templates. Most exports map one-to-one — one policy at the source becomes one template in Panoptica365. The choice of *what's worth turning into a reusable template* is a judgment call; not every customer-specific policy should be templated.

**Step 3: Be aware of what doesn't generalise automatically.** This is where Intune is more painful than CA. The CA import flow does named-location generalisation (April 23 work, `project_named_location_generalization`); the Intune import flow does **not** do equivalent generalisation today. References that won't carry cleanly across tenants include:

- **Group references** — assignments and exclusions target Entra security groups by GUID. A group with the same name in tenant B has a different GUID than tenant A. An imported template that references a source-tenant group GUID won't deploy cleanly elsewhere.
- **Certificate references** — profiles that reference certificates by serial number or thumbprint don't carry across tenants.
- **Filter references** — assignment filters by device platform/model/manufacturer are tenant-specific by GUID.
- **Notification template references** — for compliance policies that trigger user notifications.

The operator's responsibility today is to manually clean these references from the imported template, or to accept that the template will need adjustment at each destination tenant before it can deploy.

**Step 4: Name and describe the template.** Use the `MSP-name - <descriptive name>` convention. Custom templates should be distinguishable from the bundled `Panoptica365 - ...` templates in the customer's deployed policy list.

**Step 5: Save to the library.** From this point, the template behaves like the bundled ones for deployment, drift detection, and re-deployment.

## What the export shape looks like

The Microsoft Graph export Intune produces — and the shape the bundled `Panoptica365 - ...` templates were built from — is structured JSON. Each exported policy has:

- A `policyType` field — `deviceCompliancePolicies`, `configurationPolicies`, `deviceConfigurations`, or `intents` — identifying which Intune policy family it belongs to.
- A `name` and `category` identifying the template's purpose.
- Either a `policy` object (the configuration data) or a `settings` array (the per-setting configurations), depending on the policy family.

The bundled templates have all been generalised — they don't carry source-tenant group GUIDs, certificate references, or other tenant-specific objects. They deploy cleanly to any customer tenant. The same generalisation work — currently manual — applies to any custom template you import.

## What can be exported portably and what can't

Worth being explicit about Intune's portability limits:

**Portable cleanly:**
- Settings Catalog policies (Configuration Policies) — the modern format, almost all settings are portable.
- Compliance policies — the policy structure is portable; some settings reference tenant-specific values that need substitution.
- Endpoint Security templates (ASR Rules, Firewall, Defender, Account Protection) — mostly portable; assignment groups need substitution.

**Mostly portable with placeholders:**
- Configuration Profiles (Device Configurations) — older template type; some properties tie to tenant-specific Wi-Fi networks, VPN servers, certificate authorities.
- App Configuration Policies — reference apps that exist as managed apps in the tenant; the app reference is portable but the customer must have the app available.

**Hard or impossible to port portably:**
- **App Protection Policies (APP/MAM).** Reference specific apps; their behaviour depends on tenant-specific identity configuration. Often need per-tenant re-creation rather than templating.
- **Templates that deploy certificates** — certificates are inherently per-tenant. The template structure ports; the certificate itself doesn't.
- **Templates that reference custom filters** — assignment filters need to be created at the destination tenant before the template can deploy.
- **App deployment configurations** — assigning a specific app to a specific group is mostly per-tenant.
- **Anything depending on Conditional Access state** — some Intune configurations interact with CA policies (e.g., compliance policy notifications routed through CA); those references need re-creation.

The Panoptica365 import flow does not flag non-portable elements for you today — they come through in the imported JSON and the operator has to spot and clean them manually before relying on the template for cross-customer deployment. The bundled `Panoptica365 - ...` templates underwent exactly this manual cleanup when they were built; your custom imports need the same discipline.

## When *not* to import

Two specific cases where importing is the wrong move for Intune:

**The template is platform-locked.** A configuration profile that targets `windows10` only doesn't help a customer with no Windows devices. Importing it adds to the library but provides no value to that customer. If you're importing for cross-customer reuse, target it at the platforms your customers actually have.

**The template depends on tenant-specific infrastructure that doesn't generalise.** A configuration that references a specific on-premises Active Directory domain, a specific certificate authority issuing managed-device certs, a specific on-premises Wi-Fi infrastructure — these don't generalise. Even after manual cleanup, the destination tenant needs equivalent infrastructure for the template to be useful. If the source tenant has corporate AD CS and the destination is cloud-only, the template doesn't fit.

For these cases, build per-tenant Intune policies directly rather than templating.

## The bundled library is the floor, not the ceiling

The same point made in card 3 lesson 8: the templates Panoptica365 ships are a starting point, not the limit. The MSP that takes Intune seriously builds their own templates on top of the bundled library:

- Templates for specific industries (medical imaging, legal, accounting).
- Templates for specific compliance frameworks (CIS, NIST, HIPAA, SOC 2).
- Templates for post-incident hardening (deployed after a customer compromise).
- Templates the senior engineer has built for their preferred hardening posture.

These templates live in the MSP's instance of Panoptica365, not in the Panoptica365 product distribution. They become part of the MSP's competitive advantage — the IP that distinguishes one MSP from the next.

## Maintaining imported templates

Like CA templates (card 3 lesson 8), Intune templates need maintenance:

- **Microsoft Graph schema changes.** Microsoft renames properties, deprecates settings, adds new ones. Imported templates may need updating.
- **Customer environment changes.** A customer's tenant configuration evolves; templates that worked perfectly six months ago may need adjustment.
- **Template-vs-deployed-policy divergence.** Per-tenant tweaks by individual admins drift the deployment from the template reference.

The Panoptica365 drift detector covers bundled templates; custom templates need the MSP to verify periodically. The maintenance overhead is real — importing 20 custom templates means committing to maintain 20 templates.

## Rollout for a custom Intune template

Pilot-group deployment, same as the bundled templates, with an extra caveat: imported templates are often **less-tested** than bundled ones. They came from one tenant's experience; they may not have been validated across the variation of environments that customers represent.

1. **Pre-import inspection.** Audit the source template. Is it clean? Well-tuned? Up-to-date? Any hardcoded references that won't transfer? Fix issues at the source.
2. **Import.** Generalise references, save as template.
3. **First deployment to a single tenant**, with pilot-group deployment within that tenant. Treat the first customer as the broader pilot for this template.
4. **Days 1–14** — verify the template behaves as expected. Compliance signals correct, configurations applying, no unexpected user impact.
5. **Day 14+** — if the first customer deployment is clean, expand to more customer tenants. Each subsequent customer deployment is faster (the template is validated).

Once a custom template has been deployed across 3–5 customer tenants successfully, treat it as production-validated and continue using it with normal rollout discipline.

## What this means for the operator

Three takeaways.

**The bundled library is the floor.** Treat the 14 Panoptica365 templates as the starting point for any customer. Build on top of them with imports for whatever the customer needs that the floor doesn't cover.

**Intune imports have more placeholder types than CA imports.** Group references, certificate references, filter references, notification templates. The generalisation work is more involved. Allow more time for the first import of any given template type.

**Validate before you scale.** A bad imported template deployed across thirty customer tenants is thirty broken deployments. First-customer pilot, validate, then expand.

## What's next

- **Lesson 11: Operating Intune at scale.** The closer. Drift, exclusions, lifecycle, the assignment-loss problem.

For now: the import workflow is what turns Panoptica365's Intune module from "what we shipped" to "what your MSP knows." Use it for the platform coverage gaps, the compliance-framework templates, the industry-specific hardening, the senior-engineer-curated configurations.

---

*Sources for the data points in this lesson — Microsoft Graph API for Intune configuration policies ([Microsoft Learn — Intune Graph API reference](https://learn.microsoft.com/en-us/graph/api/resources/intune-graph-overview)); Settings Catalog policy export and import ([Microsoft Learn — Settings catalog](https://learn.microsoft.com/en-us/mem/intune/configuration/settings-catalog)); Compliance policy resource type ([Microsoft Learn — deviceCompliancePolicy](https://learn.microsoft.com/en-us/graph/api/resources/intune-shared-devicecompliancepolicy)); Endpoint Security policy template references ([Microsoft Learn — Endpoint security policies](https://learn.microsoft.com/en-us/mem/intune/protect/endpoint-security-policy)).*
