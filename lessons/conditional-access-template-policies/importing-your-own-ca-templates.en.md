---
title: "Importing your own CA templates — the Panoptica365 superpower"
subtitle: "Export any CA policy from any Entra tenant, add it to Panoptica365, and deploy it across your entire customer fleet."
icon: "upload"
last_updated: 2026-05-29
---

# Importing your own CA templates — the Panoptica365 superpower

Most CA-template tooling treats templates as a vendor's gift. The vendor ships a library; you deploy what's in the library; if you want something different, you wait for the vendor to add it. The customer in Mexico can't use a Canada-locked template. The senior engineer who built a brilliant CA policy at one customer's tenant can't easily share it with the rest of the MSP. The template library is a closed catalogue.

Panoptica365 is built differently. Any Conditional Access policy that exists in any Entra tenant — your own MSP's tenant, a specific customer's tenant, a partner's tenant — can be exported and imported into Panoptica365 as a custom template. From there, it deploys to every customer tenant in your fleet the same way the shipped templates do.

This is the platform feature that turns the CA template library from "what Panoptica365 thought of" into "what your MSP and your senior engineers know about your customers." It's also the mechanism that makes the geographic customisation from lesson 4 possible — the Mexican MSP doesn't wait for Panoptica365 to ship a Mexico template; they build one and import it.

This lesson is the workflow for that — when to use it, how it works, what to watch for.

## When to import a custom template

Five scenarios where importing makes sense:

**1. Geographic customisation.** Lesson 4's "Only allow access from Canada" template needs to become "Only allow access from Mexico" for a Mexican-based MSP, "Only allow access from France/EU" for a French MSP, etc. The OR-condition pattern stays the same; the named location changes. Import is the customisation mechanism.

**2. A custom policy you built somewhere and want to reuse everywhere.** A senior engineer at the MSP built a clever CA policy for one customer — say, a policy that requires phishing-resistant MFA specifically for users in the Finance department, with carefully-tuned exclusions for the AP clerk's mobile device. Rather than rebuilding that policy by hand for each customer tenant, export from the original, import as a template, deploy across the fleet.

**3. A regulatory requirement that needs a non-default policy.** A customer in a regulated industry (healthcare, finance, government contracting) may need CA policies that the standard library doesn't include — a specific session-frequency policy for accessing PII, for example, or a policy that enforces a particular authentication strength for specific apps. Build it once for the regulated customer, import it as a template, deploy across other similar customers.

**4. A response to a specific compromise or near-miss.** After a customer had an AiTM incident, you tightened their CA policy to require compliant device + phishing-resistant MFA for sensitive apps. You'd like that same hardened posture for other customers in the same industry. Import is the mechanism for that "spread good policy" workflow.

**5. A new threat that requires a new policy.** Microsoft announces a new attack technique, your security team designs a CA policy that addresses it, you build it once and need to deploy it across thirty tenants. Import is faster than re-creating thirty times.

The pattern in all five: a policy exists somewhere, you want it to exist somewhere else, the platform makes the transfer trivial.

## How the import works

The high-level workflow:

1. **Export from a source tenant.** In Panoptica365's CA module, select the source tenant and choose to export Conditional Access policies. Panoptica365 reads the policies from Entra ID via Graph API and produces a structured JSON representation.

2. **Choose which policies to import.** The export typically contains every CA policy on the source tenant. You select the specific policies you want to bring in as templates — typically one or two, not all of them.

3. **Generalise tenant-specific GUIDs.** This is the technically interesting step. Conditional Access policies reference users, groups, and named locations by GUID — and those GUIDs are unique to the source tenant. A "Block from outside Canada" policy in tenant A references named-location GUID `abc-123` for "Canada"; tenant B has a different GUID for the same named location. If you imported the policy raw, it would reference a non-existent GUID in tenant B and the import would fail or produce a broken policy.

   Panoptica365 handles this by substituting placeholder tokens at import time. Tenant-specific GUIDs in the source export get replaced with placeholders like `{NAMED_LOCATION_CANADA}`. When the template is later deployed to tenant B, Panoptica365 resolves the placeholder against tenant B's actual named-location GUIDs. If tenant B has a named location matching the placeholder, the deployment proceeds; if not, the operator is prompted to create one or remap to an existing location.

4. **Name and describe the template.** Give it a Panoptica365-style name and one-line description. The naming convention used by the shipped templates is `Panoptica365 - <descriptive name>` — custom templates should follow a similar pattern (`Acme MSP - <descriptive name>` or `<MSP name> - <descriptive name>`) so they're distinguishable from the shipped ones in the policy list on customer tenants.

5. **Save as a template in the Panoptica365 library.** From this point, the template behaves like any of the shipped templates — it's available for deployment to any customer tenant, supports Report-only-then-On rollout, and shows up in the drift detector.

## The named-location generalisation, specifically

The Mexican MSP example from lesson 4 is the canonical case. Walk through what happens mechanically:

The MSP exports the "Only allow access from Canada" template from one of their Canadian customer's tenants (or from Panoptica365's bundled-template view, depending on the export path). The policy references named-location GUID `xyz-canada-789` and country code `CA`.

In Panoptica365's import flow, the named-location reference gets converted to a placeholder. The template now contains something like:

```
condition.locations.include = ["{TRUSTED_LOCATION}"]
```

The MSP names this customised template "AcmeMSP - Only allow access from Mexico" and saves it.

For each Mexican customer tenant, the MSP first creates a named location called "Mexico" with the Mexico country code. Then they deploy the AcmeMSP template. At deployment time, Panoptica365 resolves `{TRUSTED_LOCATION}` against the customer's named locations and uses the GUID for the "Mexico" entry. The policy gets created in the customer's tenant with the correct location reference.

If a customer tenant doesn't have a "Mexico" named location yet, the deployment prompts the operator to create one (or to map the placeholder to a different existing named location). The system doesn't fail silently or create a broken policy.

This is the platform feature that makes lesson 4 work across geographies. The same mechanism applies to any other tenant-specific reference in an imported template — user groups, conditional access locations, authentication strength names, etc.

## What gets exported and what doesn't

Worth being explicit about: not every aspect of a CA policy is portable.

**Things that export cleanly:**
- Policy name and state (Enabled, Report-only, Disabled).
- User and group includes/excludes (by reference; the placeholder mechanism handles the GUID translation).
- App targets (by app ID; Microsoft's first-party app IDs are universal across tenants).
- Conditions: locations (via placeholders), client apps, platforms, sign-in risk levels, user risk levels.
- Grant controls and session controls.
- Authentication strength references (by name, which is consistent across tenants).

**Things that don't export portably:**
- *User-specific exclusions* by individual user ID (the user doesn't exist in the destination tenant). The export captures the *group* containing the user but the individual user-by-GUID exclusions are typically stripped or flagged as untransferable.
- *Custom security attributes* that exist only on the source tenant.
- *Reports-only result history* — that's an artifact of running the policy on the source tenant, not part of the template.

The Panoptica365 import flow surfaces any non-portable elements during the import step. The operator decides whether to drop them, generalise them, or accept the limitation.

## When *not* to import

A few honest caveats — importing isn't always the right move:

**The policy is broken or poorly-tuned at the source.** If the original policy has accumulated cruft (forgotten exclusions, outdated targets, deprecated authentication methods), importing it spreads the cruft to every customer tenant. The right move is to clean up the source policy first, *then* export and import.

**The policy is too customer-specific.** Some CA policies are deeply specific to one customer's environment — their specific user groups, their specific apps, their specific compliance state. Trying to generalise such a policy into a template can produce something that doesn't quite work for the new customer and requires per-deployment fiddling. If the per-deployment customisation is substantial, the template adds less value than just deploying ad-hoc.

**The policy depends on E5-only features and the destination tenant is Business Premium.** Risk-based CA, authentication strengths with phishing-resistant requirements, and PIM-aware policies often assume an E5 tenant. Importing those into a Business Premium customer's tenant produces a policy that doesn't enforce as intended (because the underlying signal isn't available).

**The policy is in the source tenant's exclusion list for an obvious reason.** If the policy at the source is currently disabled or has a broad exclusion because something didn't work, that's information about whether the policy is mature enough to spread. Importing a policy that the source customer turned off because it was breaking things is just spreading the breakage.

The honest principle: import policies that have been validated, are clean, are portable, and that the operator understands well. Imported templates inherit your MSP's reputation. Bad templates cost more than good policies save.

## Maintaining custom templates

A custom template needs ongoing maintenance — Microsoft changes things, the customer environment changes, the policy may need to evolve. The MSP that imported the template now owns its lifecycle:

- **Microsoft Graph schema changes.** Microsoft occasionally renames CA properties or changes the JSON schema. Imported templates may need updating to track schema changes. Panoptica365's CA drift detector covers shipped templates; custom templates need the MSP to verify periodically.

- **Customer-specific divergence.** When a customer's environment changes (they add Intune, they merge a subsidiary, they expand to a new region), the template that worked perfectly six months ago may need adjustment. The pattern is the same as for shipped templates — drift detection surfaces the differences, the operator addresses them.

- **Template-vs-deployed-policy divergence.** Over time, individual customer deployments may drift from the template (an admin makes a per-tenant tweak). Panoptica365's drift detector flags this; the MSP decides whether to (a) update the template to match the divergence, or (b) revert the customer policy to match the template, or (c) accept the divergence as customer-specific customisation.

The maintenance overhead is real. Importing 15 custom templates means committing to maintain 15 templates. Most MSPs benefit from a small number of carefully-curated custom templates rather than a large unmaintained collection.

## The MSP value proposition

The single line that captures why this matters: *every customer's best CA policy can become every customer's baseline CA policy*. The senior engineer's brilliant policy doesn't stay locked in one customer's tenant; the regulatory hardening doesn't get rebuilt thirty times; the post-incident response doesn't have to be invented twice.

The platform mechanic — export, generalise, import, deploy — is the difference between "Panoptica365's catalogue" and "your MSP's catalogue, built on top of Panoptica365's foundations." For an MSP that takes CA seriously, this is one of the highest-leverage product features. It's why the seven shipped templates in card 3 aren't the ceiling — they're the floor, and the MSP builds on top.

## Rollout for a custom template

Same as for any shipped template, with two differences. First, an explicit pre-import inspection step. Second, **the manual Report-only step in the Entra portal is strongly recommended for the first deployment of any custom template, regardless of tenant size** — imported templates are not pre-validated, and the operator hasn't seen this specific policy enforced before.

0. **Pre-import inspection.** Before importing, audit the source policy. Is it clean? Is it well-tuned? Is it the version of this policy the customer is using right now (and is happy with), or is it an older draft? Are all the references portable, or are there hardcoded user-by-GUID exclusions that won't transfer? Fix any issues in the source before importing.
1. **Import.** Pull the policy from the source tenant. Resolve placeholders. Save as a template.
2. **Pre-flight on each destination tenant.** Same as for shipped templates (lesson 1). Confirm named locations exist, break-glass excluded, etc.
3. **Day 0** — deploy via Panoptica365 (creates the policy in Enabled state). Immediately open the Entra portal and flip the policy to Report-only.
4. **Days 1–N** — Report-only review. N is longer for more complex policies; budget 7–14 days for a substantial custom template.
5. **Day N+1** — flip the policy back to Enabled in the Entra portal.

The longer Report-only window for custom templates reflects the additional uncertainty. A shipped template has been validated against many tenants; an imported template has been validated against only the source tenant. The verification window catches the differences between source and destination environments.

Once a custom template has been deployed to several customer tenants and verified to work cleanly, subsequent deployments can follow the shipped-template workflow (deploy directly, skip the manual Report-only flip) — the validation has accumulated.

## What to monitor after enforcement

Same monitoring as for shipped templates, plus one specific:

**Template drift across the MSP fleet.** When multiple customers have the same custom template deployed, individual divergence creates a fleet-wide drift question — should the template be updated to match the most-common deployment shape, or should the outlier customers be re-aligned to the template? Panoptica365 surfaces both kinds of drift.

The healthy steady-state is *near-zero divergence* between the template and the deployed policies. Substantial divergence indicates either (a) the template needs updating, or (b) the deployments are being modified per-customer in ways the template doesn't capture.

## What this means for the operator

Three takeaways.

**The shipped templates are the floor, not the ceiling.** Treat the seven Panoptica365 templates as the starting point for any customer. Build the MSP's own templates on top of that floor for any regional, regulatory, or customer-specific needs.

**Validate before you spread.** A bad imported template multiplied across thirty customer tenants is thirty broken policies. The pre-import inspection step is the most important step in the workflow.

**Custom templates are an investment, not a free win.** Each one you import requires ongoing maintenance. Better to have five well-maintained custom templates than fifty stale ones.

## What's next

- **Lesson 9: Operating CA at scale.** The meta closer. How a CA policy set evolves over years, how drift detection works, how to retire exclusions cleanly, how Panoptica365's audit log makes the long-term operation tractable.

For now: the import-template workflow is what turns Panoptica365's CA module from a vendor library into your MSP's library. It's the difference between deploying what we shipped and deploying what your senior engineers know about your customers. Use it.

---

*Sources for the data points in this lesson — Microsoft Graph API reference for Conditional Access policy export/import ([Microsoft Learn — Conditional Access policy resource type](https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccesspolicy)); Conditional Access named locations as referenced objects ([Microsoft Learn — Conditional Access: Locations](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-assignment-network)); Microsoft Graph object IDs across tenants ([Microsoft Learn — Object IDs and properties](https://learn.microsoft.com/en-us/graph/best-practices-concept)).*
