---
title: "Before you touch a template — the CA pre-flight checklist"
subtitle: "Five steps before any CA policy: verify break-glass, inventory service accounts, decide report-only, and prep users."
icon: "clipboard-check"
last_updated: 2026-05-29
---

# Before you touch a template — the CA pre-flight checklist

A consultant in Calgary once enabled a "Require MFA for all users" Conditional Access policy at 4 PM on a Friday. By 4:15 PM, the customer's service accounts — the ones that run the overnight backup, the SQL maintenance, the unattended invoice processor — were all failing authentication. None of them had MFA. The consultant didn't know they existed. The customer's IT director found out when the Monday morning backup report came in showing zero successful jobs over the weekend.

Conditional Access does not forgive haste.

This lesson is not about any specific template in the Panoptica365 library. It's the pre-flight checklist that runs before you touch *any* of them. Every template in card 3 — Require MFA, Block Legacy Authentication, the geo-policy, the admin-hardening set — assumes you've done the five things below. Skip the pre-flight and you ship a Friday-afternoon incident.

## The four parts of a CA policy (refresher)

Card 1 lesson 3 already covered the compliance loop and the structure of a CA policy. The very short version:

- **Who** — which users or groups the policy applies to (include / exclude).
- **What** — which apps or actions (Exchange, SharePoint, "all cloud apps", Azure management).
- **Conditions** — context: device state, location, sign-in risk, user risk, client app, platform.
- **Controls** — what to do when the policy matches: block, require MFA, require compliant device, require Hybrid join, apply session controls.

Every Panoptica365 CA template fills in those four fields with sensible defaults. The pre-flight is about adapting the defaults to a specific customer's reality before you flip the policy from Report-only to On.

## Five pre-flight steps, in order

### 1. Identify the break-glass account

Every M365 tenant should have at least one (ideally two) break-glass accounts — accounts that exist for the sole purpose of regaining administrative access if every other admin account is compromised, expired, locked out, or otherwise unusable.

Break-glass accounts are **excluded from every Conditional Access policy you enable.** They don't have MFA enforced via CA (they should still have phishing-resistant MFA enrolled — typically a FIDO2 key stored physically in a sealed envelope in two separate locations). They aren't blocked by geo-restrictions. They aren't subject to compliant-device requirements.

The reason is structural: if every CA policy applies to every account and a CA policy goes wrong, *nobody* can sign in to fix it. The break-glass account is the lifeboat.

Before you touch any CA template:

- Confirm the customer has at least one break-glass account.
- Confirm it has phishing-resistant MFA enrolled (passkey, FIDO2 key, or similar).
- Confirm it's in the exclusion list of every CA policy you're about to deploy.
- Confirm the credentials are stored somewhere the legitimate emergency response team can access — and somewhere ransomware can't.

If any of those four is missing, *stop the deployment*. Fix the break-glass story first.

### 2. Inventory the service accounts and unattended workloads

Service accounts are the most common cause of Friday-afternoon Conditional Access incidents. They typically authenticate via password (no MFA), often from a fixed IP that may or may not be in your trusted locations, often using legacy protocols, and they break loudly when a policy that wasn't designed for them fires on them.

Before you enable any policy, pull the list of service accounts in the tenant. Check:

- Which apps use them (SQL Server agents, scan-to-email service principals, line-of-business app authentication, etc.).
- Which IP addresses they sign in from.
- Whether they use modern or legacy authentication.
- Which permissions they hold.

Then, for each service account, decide:

- **Migrate to a managed identity** if the app supports it. Modern apps should use service principals with certificate-based authentication, not user accounts with passwords. Where the customer can afford the migration, this is the right answer.
- **Exclude from the specific CA policies** that would otherwise break it — typically Require MFA, Block Legacy Auth, geo-restrictions. Document the exclusion and the reason.
- **Plan a sunset** for the service account if it's tied to a legacy app that should be retired.

Panoptica365's exemption system supports this directly: every CA-policy exclusion can carry a justification and an expiration date. When the exclusion expires, the operator gets an alert to review it. This is how you avoid the "exception sprawl" pattern from card 2's lesson 6 — exclusions never disappear silently.

### 3. Decide whether you need a Report-only safety net

Panoptica365 templates deploy in Enabled state by default. When you click Deploy on a template, the policy gets created in the customer's tenant and starts enforcing immediately.

For most small-business tenants, this is the right behaviour. The pre-flight steps above (break-glass exclusion, service-account inventory, user communication) cover the typical concerns. Microsoft has been steering applications away from username/password service principals for years — modern apps are expected to use app registrations / enterprise apps with certificate or client-secret authentication — so the "legacy app gets locked out" failure mode is rarer than it used to be. Most tenants you'll encounter don't have anything that breaks the moment an MFA or geo-policy enforces.

If you're onboarding a customer with significant legacy infrastructure — older line-of-business apps still using service principals with username/password authentication, hardcoded SMTP credentials in scripts, custom automations using legacy auth flows, mature environments with years of accumulated integrations — the deploy-hot approach carries real risk. The policy may start blocking legitimate sign-ins immediately, and the affected service accounts will fail loudly enough to disrupt the customer's business.

For those tenants, the recommended workflow is:

1. Deploy the template via Panoptica365 (creates the policy in Enabled state).
2. Immediately open the Entra portal and flip the policy's state to **Report-only**.
3. Run a 3–7 day Report-only window.
4. Pull the sign-in log filtered to this policy's Report-only result. For each match, classify: legitimate use case that needs an exclusion, or legitimate target that needs migration.
5. Fix exclusions in Panoptica365 (so the audit trail captures the reason), modernise legacy integrations where possible.
6. Flip the policy back to Enabled in the Entra portal.

Report-only mode means Conditional Access evaluates the policy on every relevant sign-in, logs what *would* have happened if the policy were enforced, but doesn't actually enforce anything. The sign-in proceeds as if the policy didn't exist. You get the telemetry without the breakage.

**When to skip Report-only:** small-business tenants with no significant legacy infrastructure, a clean Intune posture, and a well-scoped pre-flight inventory. Most Panoptica365 deployments fit this profile.

**When to use Report-only:** large or complex environments with substantial legacy integrations; post-incident hardening where the customer can't tolerate any false positives; first-time deployment of an imported custom template (lesson 8 covers this case specifically). A few specific templates in this card — Block Legacy Authentication (lesson 3), the strategy migration in lesson 5, and any imported template in lesson 8 — recommend Report-only regardless of tenant size, because their breakage modes are harder to predict from the pre-flight inventory alone. Each lesson calls this out.

If you're not sure, lean toward Report-only. The friction cost is 3–7 days of an additional review step. The cost of a wrong-direction deployment in a complex environment is a customer outage on a workday.

### 4. Communicate to affected users before enforcement

Conditional Access changes the user experience. A policy that requires MFA where there was none before will surprise the user. A policy that requires a compliant device blocks personal-laptop access. A geo-policy may catch a salesperson on a Tuesday business trip.

Before enforcement (during the Report-only window):

- Send a tenant-wide notice explaining what's changing, what the user will see, and what to do if they get blocked.
- Brief the help desk on what alerts to expect and what the right resolution looks like.
- Identify any high-impact users (executives, sales travelers, contractors) and reach out individually.
- Document the change in the customer's change log (Panoptica365 records this automatically when you deploy from the template library).

The goal is that when enforcement starts, every user knows what to expect. No surprised users = no panic tickets.

### 5. Know what success looks like, and how to monitor it

For every CA policy you deploy, you should be able to answer in advance:

- **What sign-ins should this policy match?** (e.g., "All non-MFA'd sign-ins from outside the trusted IP range.")
- **What sign-ins should it *not* match?** (e.g., "The salesperson on a known trip with prior approval; service accounts on their static IP.")
- **What's the expected daily volume of matches?** (Roughly zero for a healthy tenant; non-zero matches mean either real threats or misconfiguration.)
- **What signals indicate the policy is misconfigured?** (Sudden surge of legitimate users being blocked; a previously-working integration starts failing.)

Panoptica365's CA drift detector covers the long-term monitoring piece — it tells you when a policy you deployed yesterday looks different today. But the operator still needs to define what "looks right" means at deployment time. Without that baseline, drift detection is just noise.

## The named-location prep work

Several Panoptica365 templates rely on named locations — the "Only allow access from Canada" template and any custom geographic policies imported from another tenant. Before enabling any of those:

- Confirm the named location in the tenant matches the customer's actual geography. The default Panoptica365 template ships with Canada; a Mexican customer's tenant needs Mexico defined as the trusted location instead. Lesson 8 covers the customization workflow.
- Confirm the IP ranges in the named location are current. Office IPs change. Branch offices move. Don't rely on a named location that hasn't been verified in the last 6 months.
- Confirm that "trusted IPs" doesn't include any IP range that's not actually trusted. A common mistake is including a vendor's VPN range or a parent company's office, neither of which the MSP can vouch for.

## The authentication-strength prep work

A few of the policies in card 3 (specifically the admin-hardening templates in lesson 6) use authentication strengths — a Conditional Access feature that lets you specify *which* MFA method must be used, not just *that* MFA must be used. "Phishing-resistant MFA" is the standard high-bar authentication strength; it accepts FIDO2 keys, passkeys, and Windows Hello for Business and rejects SMS, voice, and Authenticator push.

Before enabling an authentication-strength-based policy:

- Confirm the affected users have already enrolled the stronger method. If you require phishing-resistant MFA for admins on Tuesday and the admins are still using Authenticator push, they're locked out Tuesday.
- Use the Report-only window to verify enrolment. If the policy would have blocked an admin during Report-only because they haven't enrolled, fix the enrolment first.
- For admins specifically, plan the rollout in phases. Start with the IT operations team (they can fix themselves if they get locked out). Then expand to other admin roles.

## What this means for the operator

Three takeaways.

**Conditional Access is the layer where mistakes are most visible to users.** A misconfigured anti-phishing rule silently drops one email; a misconfigured CA policy locks out a department. Treat every deployment as a change-management event. The pre-flight inventory is the typical small-business dry run; the manual Report-only flip in the Entra portal is the dry run for complex environments.

**The break-glass account is non-negotiable.** Every conversation with a customer about Conditional Access starts with "let's verify the break-glass story." If they don't have one, the first CA work you do for them is creating it. Everything else waits.

**Document exclusions with expiration.** Panoptica365's exemption system was built specifically to make this easy. Use it. The cost of an exclusion you forgot about is a year of false-positive alerts, a security gap somebody else doesn't know about, and a compliance finding when the auditor arrives.

## What's next

The rest of card 3 walks through each Panoptica365 CA template in turn. By the time you finish:

- **Lesson 2: Require MFA for all users** — the foundation.
- **Lesson 3: Block legacy authentication** — closing the basic-auth bypass.
- **Lesson 4: Trusted location OR compliant device** — the smart geo-policy.
- **Lesson 5: Compliant device OR hybrid OR MFA** — the trust-signal OR policy, and how it relates to lesson 2's policy when both are enabled.
- **Lesson 6: Hardening admin access** — four admin templates in one lesson.
- **Lesson 7: Disable device code flow** — the Storm-2372 defence.
- **Lesson 8: Importing your own CA templates** — Panoptica365's customisation workflow.
- **Lesson 9: Operating CA at scale** — drift, exclusions, lifecycle.

Each of those lessons assumes you've done the five pre-flight steps above. The lessons themselves don't repeat the checklist. They get straight to *what each template does and how to roll it out*. The pre-flight is the foundation; the templates are the implementation.

For now: read the templates, but don't enable any of them on a customer tenant until you've done the pre-flight for that specific tenant. Conditional Access is the one M365 surface where "trust the defaults" can put a customer offline. Pre-flight is the inoculation.
