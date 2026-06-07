---
title: "Hardening admin access — stronger MFA, shorter sessions"
subtitle: "Four CA templates: phishing-resistant MFA, capped session lifetime, and admin portal protection for privileged accounts."
icon: "user-lock"
last_updated: 2026-05-29
---

# Hardening admin access — stronger MFA, shorter sessions

In 2024, Microsoft's Defender team analysed compromise events across thousands of customer tenants and found a pattern that hadn't changed since 2020: the most damaging compromises invariably involved an account with administrative privileges. The breach that started with a phished marketing intern is bad. The breach that started with a phished Global Admin is catastrophic.

The protections that work for "users in general" don't always work for admins specifically. A Global Admin who completes Authenticator push every morning has technically MFA'd, but they're also exactly the user an AiTM phishing kit is most willing to invest effort against. A privileged user signed in with persistent-browser sessions can keep that session active for days, giving an attacker who compromises their machine days of access. The admin attack surface deserves its own attention.

This lesson covers four Panoptica365 CA templates that, together, harden the admin attack surface from four different angles. Each template stands alone, but in practice they're deployed together for the same set of admin accounts.

- **Panoptica365 - Require MFA for admins** — MFA always required, for admin accounts, on every app.
- **Panoptica365 - Require MFA challenge Admin Portals** — MFA required to access admin portals, for all users (not just admins).
- **Panoptica365 - Require MFA for Azure management** — MFA required to access Azure management endpoints, for all users.
- **Panoptica365 - Disable persistent browser sessions for Admins** — Admin browser sessions don't survive browser close.

The first three add a stronger MFA bar to admin-related activity. The fourth shortens the admin session lifetime. Together, they apply four-pronged hardening to the most consequential identities in the tenant.

## The four templates, in detail

### Require MFA for admins

Description: *All admin must use MFA.* Grant: Require MFA. Users: Specific users/groups (the admin group). Apps: All cloud apps.

This is the admin-equivalent of the Require MFA for all users template from lesson 2. The Lesson 2 template covers everyone; this one ensures that even if Lesson 2 is somehow not enabled, admin accounts still have MFA enforced. It's the belt-and-suspenders policy for the highest-value accounts.

The "Specific users/groups" scope typically points to a security group named something like "Tenant Admins" or "Privileged Identities" — whatever the customer uses to identify admin accounts in their directory. The group should include everyone with directory-level admin roles (Global Admin, User Admin, Helpdesk Admin, Exchange Admin, SharePoint Admin, etc.).

When this template is deployed alongside lesson 2's "Require MFA for all users," the admin policy is mostly redundant for normal sign-ins (lesson 2 already covers admin accounts because admins are users). But the admin policy provides a critical defence-in-depth check: if lesson 2 is ever disabled, weakened, or has an exclusion list that grows to include admin accounts by mistake, this template still catches them.

### Require MFA challenge Admin Portals

Description: *Require MFA challenge for Admins accessing admin portals.* Grant: Require MFA. Users: All users. Apps: 1 app (Microsoft Admin Portals).

This template attacks the problem from a different angle: instead of restricting *who* must MFA (the admin user group), it restricts *what* must MFA (the admin portals). The "Microsoft Admin Portals" service in Entra ID represents the cluster of admin-facing portals — Entra admin centre, Intune admin centre, Microsoft 365 admin centre, Exchange admin centre, etc.

Why this matters: a sign-in to a regular cloud app and a sign-in to the admin portal are *different sign-ins* from Microsoft's perspective. A user could have already completed MFA an hour ago when they opened Outlook, and then click into the Entra admin centre without being re-challenged. The previously-completed MFA satisfies the lesson 2 / lesson 5 policy because they're already MFA'd in the session.

This template forces a *fresh* MFA prompt specifically when accessing admin portals — even if the user is already signed in with MFA elsewhere. The intent is to ensure that the user demonstrates current presence specifically at the moment they're about to perform an admin-level action. An attacker who stole a session cookie an hour ago doesn't have current MFA; the policy catches them when they try to elevate.

The "Users: All users" scope is deliberate. Normal users shouldn't be accessing admin portals at all, but if a misconfigured guest or a delegated GDAP user clicks in, they need to MFA. Admins who already MFA'd recently will see one additional MFA prompt; the friction cost is small, the security benefit is large.

### Require MFA for Azure management

Description: *Azure management requires MFA.* Grant: Require MFA. Users: All users. Apps: 1 app (Microsoft Azure Management).

Same structural logic as the admin-portals template, but specifically for Azure management endpoints — Azure portal, Azure CLI, Azure PowerShell, ARM REST API, the lot. Azure management is a particularly sensitive surface because resources there often have implicit trust to other parts of the customer's infrastructure (managed identities, role assignments).

The reason for a separate template (vs. covering it via the admin-portals policy): Azure management is tracked as a distinct application in Entra. Microsoft's M365 admin centre and Microsoft's Azure management surface are separate apps, even though they both feel like "admin stuff." If you want both covered, you need both templates.

If a customer doesn't use Azure at all (no Azure subscriptions, just M365), this template is technically unnecessary. It's also harmless to enable — it just doesn't fire for any sign-ins. Deploy it anyway for forward-compatibility; the day the customer adds an Azure subscription, the policy is already in place.

### Disable persistent browser sessions for Admins

Description: *Admins will be required to authenticate after closing their browsers.* Grant: None. Users: Specific users/groups (the admin group). Apps: All cloud apps. Session: Persistent browser session = Never persistent.

This is a session control, not an authentication control. The three policies above govern *whether* MFA happens. This policy governs *how long* a sign-in stays valid.

By default, when a user signs in and clicks "Yes, keep me signed in" or when the browser keeps a session cookie, the session can persist across browser restarts. Close the browser at 5 PM, open it at 9 AM the next day, you're still signed in — no re-authentication needed.

For admins, that's too long. An attacker who compromises an admin's laptop after hours has a window of opportunity that lasts until the next time the admin's session expires naturally — which could be days. Disabling persistent browser sessions for admins means each browser-close terminates the session; the admin signs in again fresh when they reopen their browser.

The friction cost is real (admins sign in more often). The security benefit is also real: the window during which a stolen device or a misappropriated session can be used shrinks dramatically. For admin-level accounts, the trade-off favours security.

This policy is the closest thing to "sign-in frequency = every session" Microsoft offers. The mechanism is slightly different (it disables session persistence rather than capping session lifetime) but the effective outcome is similar.

## Why four templates, not one big "harden admins" policy

A reasonable question: why not combine all four into a single template?

Three reasons:

**Scope differences.** Lesson 6.1 (Require MFA for admins) scopes by *user group* — it applies to admins regardless of which app they're using. Lesson 6.2 (Admin Portals) and 6.3 (Azure management) scope by *application* — they apply to anyone accessing those portals. Lesson 6.4 (Disable persistent browser) scopes by user group and applies a *session control* rather than a grant control. These different scoping models don't combine cleanly into a single CA policy.

**Independent enforcement.** Each template provides defence at a different layer. Admin-MFA covers identity. Portal-MFA covers fresh presence. Azure-MFA covers a specific high-risk app. Browser-session covers session persistence. If one is misconfigured or has an exclusion that grows over time, the others still provide coverage. Splitting them keeps the failure modes independent.

**Operational clarity.** Each template has its own name, its own description, its own audit trail. When the Panoptica365 drift detector flags a change, the operator knows exactly which protection moved. A monolithic "harden admins" template would obscure which specific protection changed.

## What "admin" means for these templates

The admin user group is a customer-specific definition. For most tenants, it should include:

- **Global Administrator** — full directory control. Everyone in this role.
- **Privileged Role Administrator** — can manage role assignments. High-value target.
- **Conditional Access Administrator** — can change CA policies. Particularly dangerous if compromised because they can disable other policies.
- **Security Administrator, Security Reader** — handles security alerts and configurations.
- **Exchange Administrator, SharePoint Administrator, Teams Administrator** — control specific services.
- **User Administrator, Helpdesk Administrator** — can reset passwords and manage MFA registration.
- **Authentication Administrator** — can manage MFA methods.

The customer's specific list depends on their structure. A small tenant may have only two admins. A larger one may have a dozen distinct roles. The right group membership is "anyone who, if compromised, could cause significant damage." This usually maps to anyone with a directory-level admin role plus anyone with permissions to manage privileged resources (Azure subscriptions, SharePoint sites with sensitive data, etc.).

**Privileged Identity Management (PIM)** — available only in E5 — changes this conversation. With PIM, users don't have permanent admin roles; they activate roles temporarily when needed. The admin user group in a PIM-enabled tenant might be empty for most of the day, populated only when a user activates a role.

For tenants with PIM, the admin-hardening templates should still target the *pool* of users *eligible* to activate admin roles, not just the currently-active admins. The protection needs to be in place before the user activates, not after.

## Authentication strengths — when to upgrade from MFA to phishing-resistant

The templates above all use "Require MFA" without specifying which MFA method. By default, this accepts any MFA method the user has enrolled — Authenticator push, SMS, voice, hardware token, etc.

For admins, the right bar is *phishing-resistant MFA* — FIDO2 keys, passkeys, or Windows Hello for Business. Push notifications are vulnerable to fatigue (card 2 lesson 2). SMS is vulnerable to SIM swap. Voice is vulnerable to social engineering. Only phishing-resistant methods are immune to the AiTM attack pattern from card 2 lesson 3.

In Entra ID, this is configured via **authentication strengths** — Conditional Access policies can specify which authentication strength is required. Microsoft ships several authentication strengths:

- *Multifactor authentication* (any MFA method)
- *Passwordless MFA* (any passwordless method, including Windows Hello and Authenticator passwordless)
- *Phishing-resistant MFA* (FIDO2, passkeys, certificate-based, Windows Hello for Business only)

The shipped Panoptica365 admin-MFA templates use the default "Require MFA" grant, which accepts any MFA method. For customers who want to upgrade to phishing-resistant for admins, the customisation is:

1. Open the deployed Require MFA for admins policy in the Entra portal.
2. Under Grant controls, change "Require multi-factor authentication" to "Require authentication strength: Phishing-resistant MFA."
3. Verify (in Report-only or by checking admin authentication-methods registrations) that affected admins have FIDO2 keys or passkeys enrolled.
4. Apply the change.

The same upgrade can be applied to the Admin Portals and Azure management templates if the customer wants to require phishing-resistant MFA specifically for those high-value sign-ins.

When to push this upgrade:

- Customers who have already been compromised once (the post-incident hardening).
- Customers with regulated data (finance, healthcare, government contractors).
- Customers with sufficient Intune coverage to issue managed devices with Windows Hello for Business.
- Customers willing to provide FIDO2 keys for admin staff (typically a $40-$60 hardware investment per admin).

For tenants without those drivers, the default "Require MFA" is the right starting point. The phishing-resistant upgrade is a credible path forward when the customer's security posture matures.

## Rollout

The four admin templates deploy together. They all deploy in Enabled state.

Pre-flight: confirm the admin user group is well-defined, break-glass account is excluded from all four templates, admins know what's coming. Most critically, **verify every admin has phishing-resistant MFA registered** (or at least Authenticator push). If an admin doesn't have MFA enrolled, they're locked out the moment the policy enforces.

For small-business tenants with a small, well-known admin group and verified MFA enrolment, deploy and monitor closely. For larger tenants with many admins, mixed MFA enrolment, or complex existing CA policies, the manual Report-only step in the Entra portal is recommended. Deploy via Panoptica365 (creates in Enabled), then in the Entra portal flip all four policies to Report-only. Run a 3–7 day window.

During the verification window (whether Report-only or live monitoring after deployment), check each template's matches:

- Require MFA for admins: should match every admin sign-in.
- Admin Portals: should match every admin-portal access (admin or non-admin).
- Azure management: should match Azure portal / CLI accesses.
- Persistent browser session: should match every admin browser session.

For each template: are the matches what you expect? Any unexpected non-admin users hitting the portal policies? Any admins with no recent admin-portal activity? Investigate anomalies.

After enforcement, monitor for two weeks:

- Admin sign-ins should complete MFA more frequently (the admin-portals and Azure-mgmt policies will fire even when the admin is already MFA'd in their general session).
- Admins reopening their browsers should see fresh sign-in prompts (persistent-browser-session policy).
- No admins should be locked out — verify after deployment that every admin has signed in successfully.

## What to monitor after enforcement

**Failed admin MFA challenges.** Bursts of failed MFA on admin accounts are the highest-priority alerts in your queue. Even more than for regular users, this is the pattern that precedes a serious compromise. Treat with maximum urgency.

**Admin sign-ins from unexpected locations.** Foreign-IP or impossible-travel alerts on admin accounts are not "trip with the family" events — they're either pre-planned admin work or attempted compromise. Verify before resolving.

**Drift on any of the four templates.** Any change to the admin policies — scope change, control change, disable — should be audit-logged and reviewed. Panoptica365's CA drift detector covers this. Admin-policy drift is the highest-severity drift category.

**New methods added to admin authentication.** When an admin adds a new MFA method, the post-compromise attacker pattern (card 2 lesson 3 — register-a-new-MFA-method after AiTM) applies double for admins. Treat new admin auth-method registrations as confirmation-required events.

## What Panoptica365 sees

The Daily Activity widget shows admin MFA challenge volume; the CA-block count rises with the admin templates enforcing. Specifically:

- Admin MFA prompts (challenges) — should be steady at a few per admin per day.
- CA blocks on admin templates — should be rare; each one is an admin or non-admin trying to access an admin surface without MFA. Investigate every block.
- Drift alerts on any of the four templates — fire as part of the CA drift detection pipeline.

The Panoptica365 alert engine treats admin-account alerts at a higher severity than regular-user alerts by default. An admin MFA-disabled alert (one of these templates getting disabled) is a high-severity event; an admin foreign-IP sign-in is high-severity; an admin new-auth-method registration is high-severity.

## What this means for the operator

Four takeaways for daily work.

**Deploy these four templates as a set.** They protect different angles of the same problem. Deploying just one or two leaves gaps in the admin attack surface.

**Define the admin group carefully.** Anyone with directory-level admin roles, plus anyone with privileged access to high-value resources. PIM-enabled tenants should target the *eligible-admin* pool, not just currently-active admins.

**The friction cost is real but worth it.** Admins will see more MFA prompts, more frequent sign-ins. This is the intended trade-off. The alternative — looser admin sign-in policies for the sake of convenience — is exactly the gap attackers exploit.

**Plan the upgrade to phishing-resistant MFA.** The default "Require MFA" admin policies should be upgraded to "Require phishing-resistant MFA" when admins have FIDO2 keys or passkeys enrolled. This is the highest-leverage single security upgrade for any customer's admin posture.

## What's next

- **Lesson 7: Disable device code flow.** The Storm-2372 defence, as a dedicated CA template.
- **Lesson 8: Importing your own CA templates.** How to customise the admin-hardening templates (or anything else) for an MSP's own preferences.

For now: these four templates are the foundation of admin security in M365. A customer who has all four deployed has materially better protection against the most consequential class of compromise. A customer who only has "Require MFA for all users" enabled is still exposed at the admin layer because the admin-specific paths (portal access, Azure management, session persistence) aren't covered. Deploy the four templates together.

---

*Sources for the data points in this lesson — Microsoft Learn on Conditional Access for admin protection ([Microsoft Learn — Conditional Access policies and admins](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/best-practices)); Microsoft Admin Portals as a CA target ([Microsoft Learn — Microsoft Admin Portals app](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-cloud-apps#microsoft-admin-portals)); authentication strengths overview ([Microsoft Learn — Conditional Access authentication strengths](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-strengths)); session control reference for persistent browser sessions ([Microsoft Learn — Conditional Access: Session controls](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-session)).*
