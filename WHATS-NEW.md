# What's New in Panoptica365

Customer-facing release notes. Each version below describes what changed in
that release, newest first.

---

## Version 0.2.31 — 2026-06-30

### Sharper AI analysis, now powered by Claude Sonnet 5

Panoptica365's deeper AI write-ups now run on **Claude Sonnet 5**, Anthropic's newest Sonnet model, upgraded from Claude Sonnet 4.6. This is the model behind the features that read your environment and explain it in plain language: the known-good **application triage**, the **identity threat-correlation** timeline, the 24-hour **alert digest**, the **Security Posture** report narrative, and the **email-authentication** summaries. Sonnet 5 brings stronger reasoning and better-calibrated judgement, so those verdicts and narratives are more accurate. Nothing changes in how you use Panoptica365 — the same actions simply produce better analysis.

---

## Version 0.2.30 — 2026-06-29

### OAuth consent alerts are clearer — and no longer flood

When a user or admin consents to an application, the alert now names the **application** that was granted access and the **resource** it can reach — for example *"…consented to Acme Mail Connector for access to Microsoft Graph"* — instead of an unreadable string of Microsoft identifiers. Repeated identical consents from the same user to the same app now **collapse into a single alert** with a recurrence count, rather than creating a new row every time, so an app a user keeps re-approving no longer buries the dashboard. Routine user consent to safe permissions is now **low** severity (it was medium); an admin consent, or any consent that requests a high-risk permission, still surfaces as **high** or **severe**. And an escalation — the same user and app now admin-consenting or requesting a risky permission — always raises a fresh, separately-flagged alert instead of being quietly absorbed into the routine one.

### Add alerts to an existing roll-up

Roll-ups let you group related alerts under one item to investigate together. Until now you could only group alerts at the moment you created the roll-up. You can now **add more alerts to an existing open roll-up** from two places: select alerts in the list and choose **Add to Roll-up**, or open a roll-up and use **Add alerts** to pick from that tenant's open alerts. The added alerts are folded in exactly like a merge, the roll-up's severity rises if a more serious alert joins, and any linked PSA ticket is updated in place rather than opening a new one. Same tenant only; available to Member and Admin operators.

### Silence a credential-expiry alert you're waiting on someone else to fix

When Panoptica365 warns that an app's client secret or certificate has expired or is about to, the fix is sometimes out of your hands — for example a client's WordPress mail plugin whose secret only their web agency can rotate. Until now that alert came back on every poll. You can now click **Create exception** on a credential-expiry alert, add a note (e.g. *"advised client, waiting on their web agency"*), and it stops re-firing — for **that one credential only**. Every other app and credential keeps alerting, and when the credential is finally rotated the replacement is tracked on its own and will warn on its own expiry. Revoke the exception any time from the Exemptions page.

---

## Version 0.2.29 — 2026-06-29

### Operator guides refreshed for the latest release

The **Panoptica365 Guides** in the Learn hub are now up to date with the last few releases. The Conditional Access and Intune guides describe the new file-based bulk import (with duplicate-name handling and per-item results), whole-policy drift monitoring, hourly checks on adopted policies, and accepting a drifted policy's current state as its new baseline. The Security-settings guide reflects the at-a-glance compliance model, where a setting turns green on its own once it matches and **Apply** and **Accept current as baseline** are the two actions. The alerts guides add the new alert types — app secret/certificate expiry, a user blocked from sending mail, and newly discovered unmanaged policies — and the one-click **Create exception** for already-blocked inbound spam. The dashboard, applications, reports and exemptions guides pick up storage shown in GB, the SharePoint **Audits** tab, credential-expiry badges, and the fuller administrator roster in the Configuration Documentation report. The tenant-dashboard guide now covers all ten tabs, and a brand-new **Email authentication** guide explains the Email Auth tab — each domain's SPF, DKIM and DMARC, graded and watched for drift. Every guide is updated in English, French and Spanish.

---

## Version 0.2.28 — 2026-06-28

### Importing a batch of Intune policy templates no longer fails

Importing a full export of Intune configuration policies — for example a ZIP of eleven policies — into your template library used to fail with **"Import failed: HTTP 500"**, and you had to import them one at a time. Panoptica365 now imports the batch in small groups, so a large ZIP goes through in a single action with a live **"Importing X of Y…"** progress indicator. If an individual policy can't be imported the others still succeed: the import window stays open and lists exactly which policies failed and why — for example *"Policy is too large to import"* — so you can retry just those with one click instead of starting over. This only affects Panoptica365's own template library; it does not touch your client tenants.

### Conditional Access import, simplified

Conditional Access template import now works just like Intune: upload an exported **ZIP** (or a single policy's JSON file), pick which policies to import, and they're added in robust batches — with live progress, per-item results and one-click retry. The template name and description come straight from each policy, so there's no longer a form to fill in. When the ZIP came from a tenant Panoptica365 manages, named-location references are translated to portable placeholders automatically.

### Conditional Access drift now watches the whole policy

Previously you chose *which fields* of a Conditional Access policy to watch for drift. Now Panoptica365 watches the **entire policy** — exactly like Intune — and alerts on any meaningful change, ignoring noise like internal IDs and timestamps. Nothing to configure. **Heads-up:** because more of each policy is now compared, existing assignments may surface drift on fields that weren't watched before (locations, session controls, sign-in/user risk, platforms…), and any drift you had previously *accepted* may re-appear once — just Accept it again to clear it.

### Adopted policies are now checked for drift every hour

When you adopt a Conditional Access or Intune policy that already exists in a tenant, Panoptica365 watches it for changes. That check now runs **every hour** instead of once a day, so a weakening change to an adopted policy is caught within the hour rather than the next day. Brand-new policies that appear in a tenant are picked up on the same hourly pass: each becomes a monitored card and raises a single **"new policy appeared"** alert for you to review — so a policy added outside Panoptica365 is never silently treated as normal.

### Accept the current state of an adopted policy as its new baseline

When an adopted policy has drifted and you've decided the change is intended, you can now click **Accept as baseline** on its card. Panoptica365 records the current live state as the new monitored baseline, clears the drift, and resolves the alert — then monitors against that state from then on. This updates only Panoptica365's record; nothing is written to the tenant. Re-importing your existing settings never moves a baseline on its own, so a silent change can't slip in that way.

### Importing a template that already exists now asks what to do

If you import a policy whose name matches a template you already have, Panoptica365 no longer creates a silent duplicate. It pauses and lets you choose, for each clash: **import as a new copy** (the original is left untouched) or **overwrite** the existing template. If the template you'd overwrite is already deployed to tenants, you're warned how many — overwriting changes their compliance baseline and flags them as drifted until you redeploy, which stays a separate, deliberate step.

### New alert: an account blocked from sending email (possible compromise)

When Microsoft blocks one of a tenant's own accounts from sending mail because its outbound volume tripped the spam limits, that is almost always a compromised account being used to send spam or phishing. Panoptica365 now raises this as a dedicated **high-severity** alert with its own explanation and step-by-step response, instead of folding it into a generic "Defender alert." It works on Business Premium — Defender for Office 365 P2 is not required. Other Microsoft Defender alerts are unchanged.

---

## Version 0.2.27 — 2026-06-27

### Security settings now show real compliance at a glance

On the Tenant Security page, a setting's status light now reflects the tenant's **actual** configuration on every check — not just whether you clicked **Apply** or **Match Current** in Panoptica365. A setting that is already correctly configured (for example, Unified Audit Log already enabled) now shows **green** with no action required, instead of sitting grey until you needlessly changed something.

The light has four clear states: **green** — compliant with the recommended value, or with a value you have explicitly accepted as the baseline; **orange** — a readable value that is off the recommended setting and was never accepted, a review flag only (no alert); **grey** — nothing readable to evaluate, so there is nothing to monitor (no alert); **red** — a setting that was compliant and has since drifted, which is the only case that raises a drift alert. The **Accept** action is now available on orange as well as red, adopting the current value as the monitored baseline for tenants that intentionally run a different value. Adding a new tenant never produces false alerts on its first check.

---

## Version 0.2.26 — 2026-06-27

### SharePoint audits are now tracked background jobs, with an Audits tab

SharePoint library audits no longer block the screen or jump you to the result when they finish — launching one simply queues it and leaves you where you are, so you can fire several in a row. A new **Audits** tab in the SharePoint section shows every audit job — running, queued, and recently finished, failed or cancelled — with its progress, timestamps and who started it, so nothing is lost after you click away. You can audit a single library, **all libraries in a site**, or **all sites in a tenant** in one action, each with a confirmation scaled to how large the run is. Jobs run a few at a time in the background so they never slow down security monitoring, retry automatically when Microsoft Graph throttles, and resume after a restart. You can cancel queued jobs (one or all) and re-run a failed one, and a **Show all tenant jobs** checkbox lets you watch audits across every managed tenant at once.

### SharePoint inventory: Last Audit Date, and reports in the tenant's language

The SharePoint inventory now shows a **Last Audit Date** for each site and library (or "Never" if it has not been audited). The two SharePoint permission reports (Library Permissions and User Permissions) are now produced in each tenant's configured language — French, English or Spanish — like the rest of Panoptica's reports.

### SharePoint permission PDF: no more overlapping rows

In the permission PDF export, entries whose permission source spans three or four lines no longer overlap the next row — row height is now dynamic and the text wraps cleanly inside the cell. Raw group identifiers that occasionally leaked into the PDF are replaced with a readable label, so client-facing reports show no internal IDs.

### App secret and certificate expiry early warning

Panoptica now watches the client secrets and certificates on your tenants' app registrations and warns you before they lapse — at 30 days, again at 7 days, and once expired (one alert per credential, so it never spams). The expiry is also shown right in the **Applications** tab: a badge on the app's row, the date highlighted in the expanded detail, and a count in the tab summary — so you can rotate a credential on your own schedule instead of discovering it the morning an integration stops working.

---

## Version 0.2.25 — 2026-06-27

### Silence noisy "already handled" alerts with one click

Microsoft blocks a great deal of inbound spam, malware and phishing before it ever reaches a mailbox — and until now each one still raised an alert, cluttering the dashboard with items that need no action. You can now click **Create exception** on such an alert and choose to silence it for **just this tenant** or for **all managed tenants**. The exception clears the matching open alerts to history right away and quietly auto-resolves future ones, while leaving everything else firing as before — including outbound spam from a compromised account, which is a different policy and a genuine account-takeover signal. Exceptions are permanent until you revoke them on the **Exemptions** page, where they appear with their scope so you can review or remove them at any time.

### Configuration Documentation report now lists every administrator

The Configuration Documentation report previously listed only Global Administrators. It now lists **every account holding an administrative role** — Exchange, SharePoint, Teams, Intune, User, Helpdesk administrators and more — each with the roles it holds, whether the account is enabled, and its MFA status. The Global Administrator count is still shown as a summary figure. (Note: the report shows roles that are actively assigned; PIM-eligible-but-not-activated assignments are not listed.)

### SharePoint Storage Overview — accurate totals

The SharePoint Storage Overview was over-counting storage. Because a site's document libraries share one storage pool, each site's storage was being counted once per library and then summed, inflating the tenant total. Each site now appears **once**, with its true storage and a count of its libraries, and the bars show each site's share of the corrected total instead of always filling for the largest site.

### Smaller fixes

Storage figures in the tenant dashboard's top-users and top-mailboxes panels now display in gigabytes instead of raw megabytes. The in-app update screen's health-check message reads more clearly. And in dark mode, the version headings in the What's New window are no longer dark-on-dark.

---

## Version 0.2.24 — 2026-06-24

### Reports — reviewed and polished

We went through all three reports — the **Security Posture report**, the **Quick Assessment**, and the **Configuration Documentation** — and gave them a thorough review and polish across English, French and Spanish.

The headline addition is a new **Email Authentication** section in each report: the published SPF, DKIM, DMARC and related DNS posture (with an A–F grade) for the tenant's sending domains, so the report shows how well the client is protected against email spoofing. Alongside that, inactive accounts are now clearly split into members and external/guest accounts, and a range of layout and wording refinements make every report read more cleanly.

---

## Version 0.2.23 — 2026-06-23

### Email Auth: correct DKIM detection for Microsoft 365's newer record format

A fast follow-up to the new Email Auth tab. Microsoft has been moving Microsoft 365 DKIM from the older `*.onmicrosoft.com` CNAME target to a newer `*.dkim.mail.microsoft` target. The first release recognized only the older form, so a domain on the newer format — even with DKIM correctly published and actively signing — was incorrectly reported as **DKIM Fail** ("expected selectors not found"). This release recognizes both, and more importantly no longer treats the provider's target hostname as a pass/fail gate at all: any Microsoft 365 selector that resolves with a valid key now reads as a pass, so future changes to Microsoft's DKIM infrastructure won't cause a false failure either.

Also in this release: the AI analysis no longer restates the numeric score (it occasionally recomputed it incorrectly and could disagree with the on-screen gauge), and a stale AI write-up is now cleared rather than shown when a domain's records change but the analysis can't be regenerated.

---

## Version 0.2.22 — 2026-06-22

### New Email Auth tab — audit, score, and monitor every domain's anti-spoofing DNS

Each tenant dashboard has a new **Email Auth** tab that audits a customer's public email-authentication DNS and keeps watching it. Click **Refresh** and Panoptica365 reads the live records for every accepted domain — MX, SPF, DKIM and DMARC, plus the lighter mechanisms (DNSSEC, MTA-STS, TLS-RPT, BIMI, DANE) — scores the posture on a weighted A–F gauge, and uses AI to explain each record in plain language with a short, prioritized list of fixes you can make at the registrar.

What makes it more than a generic checker is the **DKIM intelligence**. Panoptica365 detects who actually sends mail for the domain (from the MX and SPF records) and cross-references that against the DKIM selectors that are published. So a tenant that runs on Microsoft 365 but whose `selector1`/`selector2` records are missing is correctly called out as **unsigned outbound mail** — not handed a false 100% because some unrelated marketing selector happened to answer. And when a sender legitimately uses unpredictable per-account selectors (Amazon SES, Salesforce, Mimecast and the like), the result is an honest **"indeterminate"** with guidance to confirm from a sent message — never a false failure.

Crucially, this is **monitored, not a one-time snapshot**. After the first read, Panoptica365 re-checks each managed tenant's domains every day and raises a drift alert the moment the posture regresses — DMARC weakened from reject to none, a DKIM selector removed or revoked, SPF loosened to `~all` or `+all`. The alert tells you exactly what changed (before → after). If you made the change, click **Accept** to set a new baseline and resolve the alert; if you didn't, investigate it at your DNS host.

As always, Panoptica365 **reads DNS only and never changes your records** — it detects, advises and deep-links; you make the fix at the registrar. Refresh is available for both managed and audit-only tenants; the daily monitoring and drift alerts apply to managed tenants.

---

## Version 0.2.21 — 2026-06-22

### Clearer guidance when a tenant gains Defender for Office 365 after a licence upgrade

When a customer moves up from a licence without Defender for Office 365 (for example, Business Standard) to one that includes it (Business Premium), the **Enable Preset Security Policy** setting now handles the change gracefully instead of dead-ending.

If you had already turned Microsoft's Standard (or Strict) preset on while the tenant was on the lower licence, the upgrade unlocks the Defender for Office 365 protections — Safe Links, Safe Attachments and impersonation protection — but Microsoft does not switch them on automatically, and there is no way to turn them on from outside the Defender portal. Panoptica365 correctly flagged the gap as drift, but the **Apply** and **Accept** buttons both stopped with a confusing "does not correspond to any documented option" message.

Panoptica365 now recognizes this exact situation and shows a short guided walkthrough to the one-time step in the Microsoft Defender portal that finishes turning the protection on. Once you've done that and refreshed, Panoptica365 adopts the now-complete protection as its baseline and resumes monitoring automatically.

---

## Version 0.2.20 — 2026-06-21

### One-click launch into any tenant's Microsoft admin consoles

Tenant Management has a new **Management Consoles** tab that turns Panoptica365 into your jump-off point for every Microsoft admin portal. Pick a tenant — or use the dense **All tenants** grid — and click straight into its Entra, Azure, Exchange, Microsoft 365, Intune, Defender, SharePoint or Teams console. Each link opens in the correct tenant context using your own GDAP delegated permissions, so there's no hunting for the right portal, no copying tenant IDs, and no extra sign-in juggling.

Two ways to work:

- **All tenants** — a compact matrix (one row per tenant, one column per console) with a frozen header and an accent-insensitive name search, so you're one click from any console of any tenant, even with a long client list.
- **Focus one tenant** — a tenant picker with larger console cards, each with a one-line reminder of what that portal is for, when you're working a single client.

You can also click any tenant's **name** in the Tenant List to jump straight to its consoles.

Everything here is **navigation only** — Panoptica365 still writes nothing to your customers' tenants and makes no changes. It just gives you the fastest path to the right console.

No setup is required: each tenant's domains are detected automatically. The four consoles that need only the tenant ID (Entra, Azure, Microsoft 365, Defender) work immediately; the rest light up as soon as the domain is detected — a moment after a tenant is added — and show a brief "Resolving…" state until then.

---

## Version 0.2.19 — 2026-06-20

### The alert bell now clears once you've triaged

The notification bell — and the **Alerts** count in the sidebar — used to keep a number on it until every alert was resolved, so an alert you'd already picked up and marked *Investigating* still lit the bell. It now counts only **new, untouched alerts**: the moment you mark one Investigating, resolve it, or dismiss it as a false positive, it drops off the bell and the sidebar. In other words, the bell means "something new needs a look," not "work is still in progress."

The **Open Alerts** figure in the bottom status bar is unchanged — it still shows everything currently active (new *and* under investigation), so you keep an at-a-glance count of your open workload.

---

## Version 0.2.18 — 2026-06-20

### DLP monitoring on brand-new tenants — completed fix

This finishes the brand-new-tenant DLP fix started in 0.2.16. On a tenant where Microsoft Purview had never been opened, the underlying "object reference" error was actually raised while *connecting* to the compliance service — a step that runs before the safeguard 0.2.16 added — so the **Monitor DLP Policy Configuration** check could still show a *Poll Error*, and **Match** could still fail.

Panoptica365 now recognizes a never-initialized DLP service no matter which step reports it, and treats it as exactly what it is: a valid empty baseline. Click **Match** to capture it, and Panoptica365 will alert you the moment a DLP policy is ever created in that tenant. Tenants that genuinely can't be read — a missing administrator role, for example — still report a clear, actionable error instead of a misleading empty baseline.

---

## Version 0.2.17 — 2026-06-20

### Learn lessons now open on every deployment

Opening a lesson from the Learn hub could fail — showing a "refused to connect" message instead of the article — on installations served through the standard secure reverse proxy. The proxy's anti-clickjacking protection was, correctly, refusing to let any page embed the app in a frame, and that also stopped the lesson viewer from showing the lesson. Lessons now load through a method that protection doesn't apply to, so they open reliably on every deployment — while the app's clickjacking safeguard stays fully in place.

---

## Version 0.2.16 — 2026-06-20

### Your action buttons can't be silenced by the browser anymore

The confirmation prompts that appear before write actions — deploying a Conditional Access policy, pushing a template, removing an Intune deployment, disabling a tenant, and the like — used to rely on your **browser's** built-in dialog. If you ever ticked the browser's "prevent this page from creating additional dialogs" checkbox (sometimes labelled "Don't ask again"), every one of those buttons would quietly stop responding — no error, no dialog — until you reloaded the page.

Panoptica365 now shows its **own** confirmation dialog for every one of those actions, across the entire product. A browser setting can no longer disable your buttons. Actions that delete or remove something show a clearly marked red confirm button, so the consequence is obvious before you click.

### DLP monitoring now works on brand-new tenants

When you onboarded a tenant that had **never** had Data Loss Prevention set up in the Microsoft Purview portal, the **Monitor DLP Policy Configuration** check showed a *Poll Error* and **Match** failed with a technical message. Panoptica365 now treats "no DLP configured" as exactly what it is — a valid empty baseline. Click **Match** to capture it, and Panoptica365 will alert you the moment a DLP policy is created in that tenant. Tenants that genuinely can't be read (for example, a missing administrator role) still report a clear, actionable error instead of a misleading empty baseline.

---

## Version 0.2.15 — 2026-06-19

### New Look for Lessons + The Human Layer

Every lesson in **Learn** — across all eight topics — has been rebuilt as a fully designed article with diagrams, callouts, and tables, and the Learn hub now displays them properly. Open any topic and click a lesson: it opens in a clean reading view with one smooth scrollbar, and it follows your app theme — light lessons when you're in light mode, dark when you're in dark. (The diagrams stay on their dark canvas by design, so they read like figures set into the page.) Everything else works as before — the blue "unread" dots, the *Updated* badges, and per-user read tracking — and lessons follow your language preference in English, French, and Spanish.

### A clearer database health readout

The **Database size** check in *Health* no longer flashes an amber warning just because a tenant's history has grown — a healthy, busy database is supposed to grow. It now simply reports the current size and the largest tables for reference, and never counts against overall health.

---

## Version 0.2.14 — 2026-06-18

### Your data looks beautiful!

Since the day you onboarded each tenant, Panoptica365 has been quietly recording a daily snapshot of its security. This release turns all of that history into charts — so you can finally *see* security improving over time, not just check where it stands today.

Every tenant dashboard now has a **Trends** tab, right next to **Overview**. It tells that tenant's story over a window you pick — anywhere from 7 days to a full year: its **Microsoft Secure Score** plotted against the benchmark for similar-size businesses, the score broken down **by category**, how many of Microsoft's recommendations you've **addressed** over time, the **issues caught and resolved** each month, how long they took to clear, alert volume per week, and the policies firing most often. It's laid out as *what the customer sees* on top and *what the MSP sees* below — ready to drop straight into a client review.

There's also a brand-new fleet-wide **Trends** page in the sidebar, just after **Heatmap**. It lifts the same idea to your whole book of **managed tenants at once**: a fleet **Secure Score** with a shaded band showing your best and worst tenant each day plus the Microsoft benchmark, how the managed book has grown, recommendations still outstanding across everyone, where the fleet is weakest by category, and the full alert-operations picture — resolved, open, time-to-resolve, volume, and your noisiest policies across all customers. When you onboard tenants partway through the window, a separate line holds your existing customers steady, so a new low-scoring tenant doesn't make it look like everyone slipped.

Both pages read from data Panoptica365 already collects, so they're instant to open and add no load to Microsoft. A freshly-onboarded tenant won't have much of a line yet — give it a few weeks and the picture fills in. A new guide, **Trend dashboards**, under **Learn → Panoptica365 Guides**, walks through every chart on both pages.

---

## Version 0.2.13 — 2026-06-17

### Tidier action dialog for tenant-sourced configurations

A couple of small visual fixes to the tenant-sourced (Adopt-in-Place) cards introduced in 0.2.11. The **Manage configuration** dialog — the one you open from a card's **Actions** — is now a clean row of icon buttons: **Stop monitoring**, **Deactivate** (or **Restore**), and **Delete**, with Delete clearly marked in red. We also fixed a text-contrast issue that made that dialog hard to read in the light theme.

---

## Version 0.2.12 — 2026-06-16

### Known-good app triage now works for tenants of any size

On the **Applications** tab, marking apps as **Known good** and saving could previously come back **"0 triaged by Sonnet"** with no error on tenants with more than about ten applications — the AI triage was sent as a single oversized request that silently truncated. The triage now runs in batches, so every application gets a verdict no matter how many there are. If any app can't be triaged in a given pass (for example, the daily AI budget was reached), you'll see a clear **"X of Y triaged — Save again to retry the rest"** message instead of a silent zero. Marking an app known good is now also recorded correctly in the MSP audit log.

### Diagnostics capture is now fast

Capturing a support bundle from **Settings → Diagnostics** used to stall for several minutes on installs with a large audit-event history. It now completes in a few seconds, shows a live elapsed-time counter while it runs, and can no longer stall on a slow database query.

### New retention control for Unified Audit Log events

**Settings → Data retention** now includes **Unified Audit Log events** — the raw Microsoft 365 activity Panoptica365 ingests for alerting and the identity timeline, and by far the largest table. It defaults to **90 days**, which is plenty since Microsoft Purview keeps the authoritative long-term copy. Raise or lower it to fit your needs.

---

## Version 0.2.11 — 2026-06-15

### Adopt a tenant's existing Conditional Access & Intune settings — monitor in place

When you onboard a tenant that already has its own Conditional Access policies and Intune configurations, you can now **start monitoring them without first pushing your own templates**. On the **CA Policies** and **Intune** tabs, a new **Import existing settings** button reads what's already in the tenant and creates a card for each policy — marked **Tenant-sourced** (a red left edge and a clear badge) so you can tell them apart from your deployed templates at a glance. Panoptica snapshots each one as the baseline and watches for changes from there.

From each tenant-sourced card you can:

- **Stop monitoring** — remove the card; this **never touches the tenant**.
- **Deactivate** — reversibly turn it off (Conditional Access: set to disabled; Intune: assignments removed), with an option to keep watching it. **Restore** puts it back exactly.
- **Delete** — permanently remove it from the tenant, behind deliberate confirmation.

Importing, deactivating, restoring and deleting are available to **Operators and Admins**; the confirmation friction scales with the risk (Delete asks you to type your own name), and every action is recorded in the **audit log** and the tenant **Change Log**.

Panoptica now also watches **every** tenant for **configuration created outside Panoptica** — a new CA policy or Intune profile authored directly in the Microsoft console — and surfaces it as a tenant-sourced card plus an alert, so a change made outside your process doesn't go unnoticed. For Conditional Access this is **near-real-time**.

Empty and unlicensed tenants are handled gracefully: if a tenant has no policies, or its plan doesn't include Conditional Access or Intune, you get a calm message instead of an error.

---

## Version 0.2.10 — 2026-06-15

### Fix: a report's executive summary could show raw code text

On busy tenants — lots of alerts, incidents, applications, and administrators — the written narrative at the top of the **Security Posture** report (and, in rarer cases, the **Quick Assessment** and **Configuration Documentation** reports) could come out with raw code-like text in the executive summary, including a `json` label and visible `\n` characters, instead of clean prose. This was most likely on reports generated in **French** or **Spanish**, where the narrative runs longer.

The cause was a length limit: on a data-rich tenant the written analysis was being cut off before it finished, and the unfinished result was being printed verbatim. We raised the limit so the full narrative fits comfortably, added a safeguard that detects a cut-off and substitutes a clean, data-driven summary instead, and made certain that an unfinished analysis can never again be printed into a report.

If you have a report showing this, simply regenerate it after updating — the new copy will be clean.

---

## Version 0.2.9 — 2026-06-14

### Export to CSV across the console

Three tables now have an **Export** button that downloads a clean, Excel-ready CSV — UTF-8 with a byte-order mark, so French and Spanish accents survive the trip into Excel for Mac:

- **Applications** (tenant dashboard) — every app with its publisher, status, Known-Good flag, and stored risk verdict.
- **Access review** — two exports: the privileged-role roster (account, roles, enabled, MFA, last activity) and the full user list (account, type, enabled, last activity, inactive). The user export always contains **every** account, regardless of the on-screen filter.
- **Audit log** — every row matching the active filters, across **all** pages (not just the visible 100), for whichever view you're in (MSP audit or the unified timeline).

### Reports now cover identity hygiene and application risk

The three reports — **Security Posture**, **Quick Assessment**, and **Configuration Documentation** — now include the same identity and application signals you see in the Access review and Applications tabs:

- **Inactive accounts** and **accounts holding admin roles** (with MFA status), drawn from the Access review snapshot and honoring your configured inactivity threshold.
- **Break-glass readiness** — whether an emergency-access group is configured and who belongs to it.
- **Application risk** — which apps are Known-Good versus not, with each unblessed app's stored risk verdict and the permissions it holds.

In the two AI reports (Security Posture and Quick Assessment), Claude now factors these signals into the written analysis as well; the Configuration Documentation report adds them as plain tables. Everything is fully localized in English, French, and Spanish, and degrades gracefully when a tenant hasn't been scanned yet (the report says so rather than inventing findings).

### Polish: a fully localized main console, and a cleaner update screen

The main console is now fully translated — the tenant-list column headers, the alert severity chart (which now reads **Severe** everywhere, matching the rest of the app, instead of "Critical"), the tenant count, and the per-row status badge all follow the selected language. The in-app Software Update screen no longer shows a redundant English line beneath each translated step.

### Reliability: saving the Applications tab no longer times out

On tenants with many applications, **Save** on the Applications tab could fail with an HTTP 504 because the AI permission-triage of un-sanctioned apps ran longer than the gateway would wait. The save now streams its progress (the same way report generation does), so it completes regardless of how long the triage takes — the sanctioning happens immediately and the green/yellow/red triage dots fill in as the review finishes.

---

## Version 0.2.8 — 2026-06-13

### New: Access review — privileged accounts, dormant accounts, and emergency access

A new **Access review** tab on the tenant dashboard (between Security and Applications) gives you a per-tenant answer to three questions: who holds administrative roles, which accounts are dead weight, and what happens if a Conditional Access policy locks everyone out.

The first table is a review-only roster of every privileged-role holder, grouped by tier, showing each account's roles, enabled state, MFA-registration status, and last activity. The second lists all user accounts with **All / Members / Guests / Inactive** filters and lets you **disable, re-enable, or delete** an account directly. Every write is confirmed, recorded to both the MSP audit log and the tenant Change log, and guarded on the server: you can't delete an account that holds an admin role, you can't disable the last Global Administrator, and a delete is a 30-day recoverable soft delete. Inactivity is derived from Microsoft 365 usage reports rather than directory sign-in logs, so it **works on Business Standard tenants** too.

### Break-glass (emergency-access) accounts, set up the way Microsoft recommends

From the same tab you can designate **break-glass accounts** — the emergency admin you reach for when a misconfigured Conditional Access policy, or a down MFA provider, has locked out every normal admin. Point Panoptica365 at a dedicated security group and it excludes that group from **every** Conditional Access policy. A safety guard refuses to exclude a group with more than a handful of members (so you can't accidentally exempt your whole company), and the result is shown policy by policy so a partial failure is never reported as success. Designating an account is then simply adding it to the group.

Two alerts come with it: a **CRITICAL alert the instant a break-glass account signs in** — which works without a Premium licence and keeps working even if you've changed the account's domain — and a coverage alert if the group ever stops being excluded from a policy. One important note on today's landscape: Microsoft now enforces MFA on admin-portal sign-ins regardless of Conditional Access, so a break-glass account should carry a **phishing-resistant key (FIDO2)** stored alongside its credentials. The guided setup walks you through all of this, including the naming practices that keep these accounts from standing out to an attacker.

### Reliability: scheduled audit-log alerts now stay current between restarts

A timing bug in the unified-audit-log evaluator could freeze its evaluation watermark on a server running in a non-UTC timezone, so audit-log alerts — admin role changes, OAuth consents, mailbox-permission grants, and the new break-glass sign-in alert — only fired reliably right after a restart. The watermark is now read in UTC, so these alerts stay current continuously.

### Also in this release

The tenant-dashboard header was reworked so the tab bar has room to grow — the tenant switcher now sits in the info bar as the page title, and the Poll Now / Log Change buttons moved alongside it. A new **Access review** guide was added to Learn (Panoptica365 Guides), in English, French, and Spanish.

---

## Version 0.2.7 — 2026-06-12

### Quick Assessment reports now open with a plain-language summary for the business owner

The Quick Assessment has always produced an operator-grade report — technical findings, configuration detail, one-click template mappings. This release adds a new **Executive Summary** as the first page of every Quick Assessment, written for the non-technical business owner or prospect you hand the report to.

It says, in plain business terms: where the tenant stands today, what could actually go wrong for the business (a lost laptop exposing client files, an account takeover, downtime — not the names of technical controls), the single most important next step and what it takes, and what "good" looks like once that step is taken. It deliberately contains no configuration keys, field names, or product jargon — so you can put it in front of an owner without translating it first.

Nothing else about the report changed: the full technical assessment — Conditional Access, Intune, security settings, strengths, and prioritized actions — follows immediately after, exactly as before. The summary is fully localized in English, French, and Spanish along with the rest of the report, and any context you type in the assessment modal informs how it is framed.

---

## Version 0.2.6 — 2026-06-12

### The AI path can no longer stall, runaway, or take alerts down with it

Every call to the AI service now carries a strict time limit (previously the underlying default allowed a call to hang for ten minutes, holding a background worker with it). A **daily AI token budget** acts as a fuse: if a runaway loop ever burns through it, AI narratives pause until midnight UTC, a dashboard alert tells you why, and everything resumes automatically — important above all for installs running their own AI key, where a runaway is a surprise bill. A **circuit breaker** stops hammering the AI service after repeated failures and retries on its own a few minutes later. In every one of these situations the invariant holds: **alerts always fire — only the AI narrative is skipped.**

### Updates now watch their own back for three minutes

The self-updater has always health-checked a new version at boot and rolled back automatically on failure. It now also keeps **observing the new version for three minutes after** the boot check passes, and rolls back if it goes unhealthy — catching the harder case of a version that boots cleanly and crash-loops a minute later. Releases are also staged through an **early channel**: the vendor's own installation absorbs each release for a few days before customer installs on the stable channel see it.

### Fleet health telemetry — so support sees trouble before you write

Once a day, your install sends a small instance-health summary to the licensing server: app version, update channel, health-check states, stale worker names, crash count, database size, disk use, and tenant *count*. **Never tenant names, user identities, alert content, or error text — customer and tenant data never leaves your installation.** The exact field list is documented in the configuration template, and `TELEMETRY_ENABLED=false` switches it off entirely.

### Every release now passes automated quality gates

New continuous-integration checks run on every change: a security lint proving every API route carries its authentication guard, a three-language completeness check (English, French, Spanish — 3,400+ strings verified identical in structure), and a fresh-install double-boot test against an empty database — the exact scenario a new customer hits first.

---

## Version 0.2.5 — 2026-06-12

### Built to survive: crash recovery, network time limits, and worker watchdogs

Panoptica365 runs unattended, so this release hardens everything that could previously fail silently. If the application ever crashes unexpectedly, the full reason is now written to the log file, a crash counter is recorded (and included in diagnostics bundles), and the process restarts cleanly. Every outbound call — Microsoft Graph, audit-log downloads, your PSA, the license server — now carries a hard time limit, so a stalled Microsoft endpoint can no longer freeze a background worker forever. And if a worker cycle ever does get wedged, a watchdog detects it, logs it loudly, and lets the next cycle proceed — no background loop can be permanently stuck again.

### Every background worker now reports its pulse

The health panel (click the status indicator in the bottom bar) has a new **Background workers** check. All of Panoptica365's background loops — metric polling, audit-log ingestion, PSA ticket sync, the CA and Intune drift schedulers, the morning briefing, the nightly cleanup, and more — now record a heartbeat after every cycle. If one goes quiet beyond its expected rhythm, the health panel tells you which one and for how long, with its last error. Workers you've left unconfigured (say, PSA without a provider) show as *idle by configuration* rather than raising false warnings.

### The database now cleans up after itself

A nightly cleanup (03:30) enforces retention windows on historical data that previously grew without limit. The new **Settings → Data retention** card shows every window, pre-filled with recommended defaults that you can adjust — each with a plain-language note on what changing it affects, and guardrails so a value can't break alerting or reports. Changes apply from the next nightly run, no restart needed, and are recorded in the audit log. **Alerts are never auto-deleted.**

The biggest win is poll-history snapshots: full detail is kept for a week (all the change-detection alerts need is the previous poll), while older history collapses to one compact Secure Score reading per tenant per day — exactly what report trend lines use. Dashboards, alerts, and reports behave identically. On our own production install, this took a two-month, 28 GB database down to 10 GB.

### New "Database size" health check

The health panel also gains a **Database size** check showing the live total and the largest tables — reading fresh statistics rather than MySQL's cached ones, so it reflects reality immediately. It warns when the database crosses a configurable threshold (10 GB by default), giving you time to plan disk before it matters.

### A quieter, tougher database layer

Under load or during a database stall, the application now fails fast instead of piling up: the connection queue is bounded, waiting for a connection has a deadline, the pool size is tunable, and any query slower than two seconds is logged (the query text only — never its data) so slowdowns are diagnosable from a support bundle.

---

## Version 0.2.4 — 2026-06-11

### Security settings now live on each tenant's dashboard

Security settings are inherently per-tenant, so they now have their own **Security** tab on the tenant dashboard — between **Alerts** and **Applications**. You no longer have to leave the tenant you're working on, open the separate Security page, and re-pick the tenant: everything for that tenant, including its security posture, is now in one place. The tab carries the same **Refresh** button to re-poll a tenant's security settings on demand, and the Heatmap's "drill into a setting" links now land you directly on this tab with the setting open.

The standalone Security page (under **Policies**) still works exactly as before — nothing was removed.

### Open a Defender incident straight from its alert

Alerts raised from a Microsoft Defender incident now show an **Open incident in Defender** button that takes you directly to that incident in the Microsoft Defender portal — no more copying the link out of the alert's raw data. Opening it requires a browser session signed in with a GDAP-enabled account for the customer tenant.

### Click a tenant's name in an alert to open its dashboard

In the alert detail panel, the tenant name is now a link. Click it to jump straight to that tenant's dashboard, instead of closing the alert, returning to the main console, and finding the tenant by hand. (Multi-tenant Message Center alerts still list their affected tenants as plain text, since they don't point at a single dashboard.)

### "Strict-only" is now a supported preset configuration

The **preset security policy** setting (Standard / Strict) now recognizes a tenant running **Strict without the Standard baseline** as a valid configuration. Previously, if a tenant drifted into that state, **Accept** dead-ended with "does not correspond to any documented option" and you had to fix it through Configure. You can now Accept that state as the baseline — or choose it deliberately — like any other preset option.

---

## Version 0.2.3 — 2026-06-11

### Fixed: drift tickets now link to their alert and close when you accept the drift

Tickets opened for **configuration-drift alerts** — Conditional Access drift and Intune policy drift — were being created in your PSA but **not linked** back to the alert. As a result they showed no ticket chip, and when you **accepted (or otherwise resolved) the drift** the ticket was left open — an orphan you had to close by hand. They now link correctly and close automatically on accept/resolve, exactly like every other PSA ticket. (Account-lockout and sign-in alerts were never affected.)

Note: drift tickets created *before* this fix have no link, so they won't close themselves — clear that backlog manually in your PSA one last time.

### Roll-ups now consolidate their tickets instead of orphaning them

When you merge several alerts into a **roll-up**, their PSA tickets are now consolidated to match. The **oldest** ticket is kept as the survivor — renamed to your roll-up title and linked to the roll-up alert — and the other tickets are **closed with a note pointing to the survivor**. Previously merging alerts left every child's ticket open. Since the PSA has no real "merge tickets" operation, this mirrors what you'd otherwise do by hand: one ticket carries the work, the rest close with a cross-reference.

---

## Version 0.2.2 — 2026-06-10

### Self-Service Password Reset: every authentication method is now its own toggle

The **Enable Self-Service Password Reset (SSPR)** control used to treat Microsoft Authenticator, SMS, and Email as a single all-or-nothing "Standard" bundle. That made a common, Microsoft-recommended hardening — turning off SMS (the weakest method) while keeping Authenticator and Email — impossible to express: the Configure tab wouldn't let you uncheck SMS, and if you removed it directly in Entra, Panoptica365 correctly detected the drift but **Accept** failed with *"Drifted current value does not correspond to any documented option."*

The Configure tab now lists **every** authentication method as its own checkbox, with the recommended trio at the top. **Standard** and **Disabled** become one-click presets — Standard checks the recommended set, Disabled clears everything — but you're free to enable any combination. Whatever you pick is synced exactly: checked methods are enabled for all users, unchecked methods are disabled, so drift detection still catches any external change to any method.

**Accept** (and **Match**) now adopt the live configuration as the new baseline no matter how it's set up, so dropping SMS — or any other method — no longer dead-ends. Existing baselines are unaffected: they keep working exactly as before and convert to the new per-method form the next time you Apply, Accept, or Match.

---

## Version 0.2.1 — 2026-06-09

### Clearer selection when scoping an alert exemption

When you create an alert exemption, the **Country scope** and **Duration** choices appear as pill buttons. The selected pill now fills with colour while the others stay plain, so it's obvious at a glance which option is active — previously the highlight was so faint it was easy to think clicking a pill had done nothing. Hovering a pill now also shows a coloured outline so it reads as clickable.

This is a visual change only. How exemptions match and suppress alerts is unchanged.

---

## Version 0.2.0 — 2026-06-07

### PSA tickets now close themselves when the underlying drift is resolved

When a configuration-drift alert is linked to a PSA ticket and that drift is resolved in Panoptica365 — whether you click **Accept**, **Remediate**, or **Match** on the setting, push a fix and let the next check confirm it, or someone simply corrects it in the Microsoft admin portal — Panoptica365 now **closes the linked ticket automatically** and adds a note explaining why. Previously the alert resolved but the ticket was left open, leaving orphaned tickets behind after a round of drift acceptances.

The one exception is deliberate: if you resolve an alert from the alert panel and choose **"Leave ticket open"**, the ticket stays open for your technician to finish. Only an actual drift resolution triggers the automatic close.

---

## Version 0.1.54 — 2026-06-07

### Switching language now updates the page you're on

Previously, changing the interface language in **Settings** flipped the top bar and the left sidebar to the new language right away, but the page in the middle — a tenant dashboard, a Learn guide, and so on — stayed in the old language. The only way to see it translated was to reload your browser, which also sent you back to the Main Console and made you navigate all the way back to where you were.

Now, when you save a new language, the page you're currently looking at refreshes in place in the new language and you stay exactly where you were. The top bar and sidebar continue to switch instantly, and nothing else about your session changes.

---

## Version 0.1.53 — 2026-06-07

### New in Learn: the Panoptica365 Guides card

The Learn section now opens with a new card, **Panoptica365 Guides** — 18 short, step-by-step operator guides covering the whole platform, in the order a new install actually unfolds. The sequence starts with **Start here** and **Add your first tenant** (including the managed vs audit-only decision and the admin-consent flow), then walks through the Main Console, the tenant dashboard, reviewing applications, deploying Conditional Access and Intune policies, monitoring security settings, working and tuning alerts, exemptions, fleet views, reports, notifications, the PSA integration, user roles, and system administration.

Each guide is deliberately short and explicit — exact button names, exact tab names, what to click and in what order — and complements the existing Learn curriculum, which covers the security knowledge behind the platform. Like the rest of Learn, the guides are available in English, French and Spanish, with the usual unread dots and UPDATED badges.

---

## Version 0.1.52 — 2026-06-07

### New: fresh installs ship with the starter template library

A new Panoptica365 install now arrives with the full curated library of Conditional Access and Intune templates already loaded — the **"Panoptica365 - …"** starter set — instead of an empty Templates page. You can review them and deploy them to your customer tenants right away, or use them as a starting point alongside your own imported templates.

**Existing installs are untouched.** The starter set only loads when your template library is empty, so anything you have already imported or customized is left exactly as it is — nothing is overwritten or duplicated, on this upgrade or any future one.

**Built to drop into any tenant.** The bundled Conditional Access templates reference locations through Panoptica365's portable placeholders (so a "block sign-ins outside Canada" template resolves to the right named location in each customer tenant), ship with empty break-glass exclusion lists for you to fill in, and carry no identifiers from any specific tenant.

---

## Version 0.1.51 — 2026-06-07

### Security hardening ahead of wider rollout

This release tightens several security defaults across setup, sign-in, and diagnostics. There are no new features, and existing installs need no configuration changes — but a few behaviours are now safer by default.

**Setup now requires an access (RBAC) group.** The first-boot wizard previously treated the three role groups (Admins / Operators / Viewers) as optional. The **Admins group Object ID is now required** to finish setup. This closes a permissive default: if all three group fields were left blank, any account that could sign in to your Microsoft tenant was granted full Admin in Panoptica365. Now you must point Panoptica365 at an Entra security group, and only members of your configured group(s) can sign in. Existing installs are unaffected — this applies to new installs and re-installs. The Operators and Viewers tiers remain optional.

**Sign-in fails safe.** If no access group is configured, Panoptica365 now denies sign-in rather than admitting everyone, and never defaults a user to Admin. The session-signing secret is also generated and saved automatically if it is ever missing or weak — so an install can never silently run on a built-in default secret, and you can never be locked out over a misconfigured one. One internal data view that was reachable without signing in now requires a valid session.

**The diagnostics support bundle is safer to share.** The redacted bundle (Settings → Diagnostics) now masks your PSA (Autotask) API credentials, and its configuration summary was switched to a "known-safe values only" model: anything it does not explicitly recognize as non-sensitive — including secrets added by future integrations — is masked rather than included. The bundle stays safe to email to support, by construction.

**Smaller, cleaner image.** Stale temporary working files are no longer included in the published container image.

---

## Version 0.1.50 — 2026-06-06

### New: native PSA ticketing — Autotask integration

Panoptica365 can now create and manage your tickets directly in your PSA through its API, instead of emailing them. The first supported PSA is **Autotask**, and it is **off by default** — nothing changes until you turn it on under **Settings → PSA Integration**.

Once enabled, with a customer mapped to its Autotask company, any alert routed to "support" opens a real Autotask ticket — under the right company, queue, priority and due date, carrying the AI analysis and a link back to the alert in Panoptica365 — instead of a parsed email. Repeated alerts for the same customer and policy (for example, several account-lockout alerts in a row) are grouped: the first one creates a ticket and the rest are added to it as notes, so your queue isn't flooded with duplicates.

Resolution stays in sync both ways. When a technician closes the ticket in Autotask, the linked alert auto-resolves in Panoptica365 within a few minutes, with a note explaining why. When you resolve an alert in Panoptica365, you're asked whether to also close its Autotask ticket — close it (with a closing note) or leave it open for the technician to finish. Every alert shows a ticket chip that links straight to the Autotask ticket.

Customers you haven't mapped — and audit-only tenants — keep using the existing email-to-ticket path, so you can adopt this one customer at a time. Credentials, the queue/priority/status choices, and the customer-to-company mapping all live in the new **Settings → PSA Integration** card. ConnectWise Manage support is planned next; the integration was built behind a provider layer so adding it won't disturb Autotask.

---

## Version 0.1.49 — 2026-06-06

### Fixed: health monitor no longer flags license-gated Graph endpoints as failures

The **Graph API endpoints** health check (and the status indicator in the bottom-left) was showing tenants as having failing endpoints when the only thing "wrong" was the tenant's license tier. Several Microsoft Graph endpoints — sign-in logs, risk detections, authentication-method reports, and the security alerts and incidents queues — are only available on higher tiers (Microsoft Entra ID P1/P2, Microsoft Defender XDR). On a tenant without those, Microsoft refuses the request, and Panoptica was counting each refusal as a failure — accumulating thousands of "errors" and painting the health box red, permanently, for tenants that were behaving exactly as licensed.

Panoptica now recognizes these responses for what they are: the capability isn't included in that tenant's licensing (or, for the security queues, Microsoft Defender hasn't finished provisioning yet after a recent license upgrade). Those endpoints are marked **unavailable** rather than failing — they no longer count against the health check, no longer light up the status bar, and stop being retried needlessly. The moment a tenant is upgraded (or Defender finishes provisioning), the endpoint clears itself to healthy on the next poll. Genuine permission problems — a revoked consent or a missing API permission — are still reported as real failures, so nothing actually broken gets hidden.

This complements the v0.1.46 fix, which made the same distinction during first-boot setup; this release applies it to the ongoing health monitoring.

---

## Version 0.1.47 — 2026-06-06

### Fixed: clearer guidance for the Exchange permission during setup

The App Registration walkthrough asks you to add the `Exchange.ManageAsApp` permission. Microsoft exposes a permission with that exact name under **two** different APIs — **Office 365 Exchange Online** (the correct one) and **Microsoft Exchange Online Protection** (the wrong one). They look identical and both accept admin consent, but only the first one works; choosing the wrong one silently leaves every Exchange and Compliance security setting stuck and unreadable.

The walkthrough now shows a prominent warning under that step spelling out exactly which API to pick (with its App ID), plus a tip: if "Office 365 Exchange Online" doesn't show up when you search by name, paste its App ID into the search box and it will appear.

### Fixed: license-agreement name field was hard to read

On the first-boot license agreement, the box where you type your full name showed light text on a white background under the dark theme, so what you typed looked blank. The field now uses dark text on white and is clearly legible.

---

## Version 0.1.46 — 2026-06-06

### Fixed: setup's "Test Connection" no longer false-alarms on license-gated permissions

The setup wizard's **Test Connection** step checks that your Entra app registration's permissions are granted. It was flagging two permissions — sign-in log access (`AuditLog.Read.All`) and security-incident access (`SecurityIncident.Read.All`) — as failures even when admin consent was correctly granted. The reason: those two Microsoft Graph endpoints also require the *tenant* to hold a higher tier — Microsoft Entra ID P1/P2 for sign-in logs, Microsoft Defender XDR for security incidents — and they refuse the request on tenants without it, no matter how the permissions are consented. That's a tenant capability, not a misconfiguration.

Test Connection now tells the two apart. A permission is only flagged red when admin consent is genuinely missing; permissions that simply aren't available on your tenant's current licenses are shown as a calm informational note ("not applicable to this tenant — safe to continue") rather than an error. No more alarming false failures on a fresh install.

---

## Version 0.1.44 — 2026-06-05

### New: License agreement acceptance

Panoptica365 now presents its End User License Agreement during first-boot setup. On a fresh install, the setup wizard pauses on the welcome step until you read the agreement, type your full name, and click **Agree and Continue** — a deliberate, recorded acceptance on behalf of your organization. The acceptance (your typed name, the agreement version, the language you read it in, and the exact time) is stored permanently.

A new **License Agreement** card in Settings (admin only) lets you re-read the agreement at any time and shows who accepted it and when. If a future update ships a revised agreement, administrators are asked to review and accept the new version at next sign-in before continuing — your technicians and viewers keep working uninterrupted, so monitoring never stops.

---

## Version 0.1.43 — 2026-06-05

### New: merge a flood of related alerts into one roll-up

When a single tenant fires many alerts for the same underlying issue — say six "MFA disabled users" alerts during an onboarding — you can now tidy them into one. Select the alerts (the bulk bar's new **Merge** button lights up once two or more are checked), confirm a title, and Panoptica creates a single **roll-up** alert to track the investigation. The originals are marked resolved and cross-linked: the roll-up lists every alert it absorbed (each a click away), and each original shows a "Rolled up into →" link back to the roll-up.

While the roll-up stays open, repeat detections of the same conditions quietly accumulate on the originals instead of firing fresh duplicates — so the noise stops without hiding anything. Resolve the roll-up and, if a condition is still present, it fires a brand-new alert on the next check — your "I thought this was handled" signal. Roll-ups can only combine alerts from one tenant, and they're deliberately left out of every statistic, report, and morning briefing (the original alerts remain the counted record).

### Improved: the bulk-action bar no longer makes the table jump

The alert dashboard's bulk-action bar is now always visible at a fixed height, with its buttons greyed out until you select something. Previously the bar appeared only after the first checkbox tick, which pushed the table down and could land your click on the wrong row. That layout shift is gone.

---

## Version 0.1.42 — 2026-06-04

### New: Disk-space monitor

Settings now has a **Disk space** card showing how much storage your server has used — used, free, total, and a percentage with a usage bar. More importantly, Panoptica now **watches it for you**: a banner appears across the top of the app at **80% used** (and turns red at **90%**) so you have time to free space before anything breaks. The same signal feeds the health indicator in the status bar. This closes a real gap — a full disk can take the whole app down, and now you get a clear warning well ahead of time.

### Reliability: logs can no longer fill your server

We hardened how logging is handled end-to-end so a chatty background process can never consume the disk: the monitoring engine's PowerShell logging is turned down at the source (inside the app image, so every install is protected the same way), and the container logs are capped. Nothing for you to configure — it's built in.

---

## Version 0.1.41 — 2026-06-03

### New: Diagnostics — capture a support bundle in one click

Settings now has a **Diagnostics** card (administrators only). When something isn't working, click **Capture diagnostics** and Panoptica assembles a single downloadable bundle with everything we need to investigate: application logs, configuration summaries, database health, recent alert and ingestion stats, disk space, and — on Docker installs — the container logs. Email it to support and we can debug remotely, even on servers we have no direct access to.

The bundle is **safe to send**: it contains no secrets, passwords, or credentials. Every value on the secret list is masked, and a redaction pass scrubs tokens and keys from every file before packaging. (Tenant names are included on purpose, so support can point you back at the affected tenant.) If a piece can't be collected — say the database is down — the bundle is still produced with everything else, and a manifest inside notes exactly what was missing. The three most recent bundles are kept for re-download.

### Behind the scenes: durable file logs + a hardened updater

Application logs now also write to rotating daily files (7-day retention), so they survive a container restart and feed the new Diagnostics bundle. And the self-updater now runs a **cryptographically signed payload** that the update component verifies before every use — a defence-in-depth improvement that keeps the most privileged part of the system locked down. No action needed on your part.

---

## Version 0.1.40 — 2026-06-03

### New: guided first-time turn-on for the Standard preset security policy (MDO)

Microsoft only creates a tenant's Standard/Strict preset email-security policies the **first time** they're turned on in the Defender portal — there is no API or PowerShell command that can create them from scratch. Until that happens, applying the setting in Panoptica had nothing to act on, so it could look like the policy "wouldn't stick".

Panoptica now **detects when a tenant has never had the preset turned on** and, on the setting's Remediate tab, replaces the Restore/Accept buttons with a **step-by-step walkthrough**. It guides you through the Defender wizard — Exchange Online Protection and Defender for Office 365 for all recipients, who to add as impersonation-protected people (executives, finance, HR), adding the customer's own domain, and turning the policy on — then explains how to hand monitoring back to Panoptica. After you've turned it on, click **Refresh**, then **Accept This Change** to adopt the live Microsoft preset as your baseline. From then on, Panoptica monitors it for drift like any other setting.

On tenants that don't have Defender for Office 365 yet (for example, Business Standard), the walkthrough automatically switches to a shorter **EOP-only** version. The Standard preset's Exchange Online Protection (anti-spam, anti-malware, anti-phishing) still applies and should be turned on there — Microsoft's wizard just skips the Safe Links/Attachments and impersonation steps. Panoptica now turns those on correctly and no longer reports the confusing poll error it used to on these tenants.

---

## Version 0.1.39 — 2026-06-02

### New: Licensing card in Settings

Settings now has a **Licensing** card (administrators only). It shows your total licensed seats, the current seat count across all the tenants you monitor, who the license is issued to, your tier, and the expiry date. A **Refresh now** button reports the current seat count to the license server immediately, rather than waiting for the weekly refresh.

If the current count is ever higher than your licensed total, the card flags how many seats you're over so you can arrange more with your provider.

---

## Version 0.1.38 — 2026-06-02

### Smoother recovery when adding a tenant hits a consent hiccup

Occasionally, finishing the admin consent for a new tenant fails with Microsoft error **AADSTS650051**. This is usually a temporary issue on Microsoft's first consent attempt — trying again succeeds. Instead of showing a cryptic error, Panoptica365 now explains what happened and offers a **Try again** button that re-runs the consent (which resolves it in most cases). For the rarer case where it keeps failing — a leftover app registration from a previous connection lingering in the customer tenant — the dialog includes a "Show cleanup steps" section with a ready-to-run PowerShell script, pre-filled with the tenant and app IDs, that fully clears the leftover so you can add the tenant cleanly.

Tip: when you remove a tenant from Panoptica365, you don't need to delete the enterprise application in the customer tenant — re-adding simply re-uses it, which avoids this situation entirely.

### Fixed: daily summary now works on fresh installs

On a brand-new installation, an internal mismatch in the database setup left the daily summary (morning briefing) unable to save or load — so the feature silently never produced a summary. The database layout is now reconciled automatically on startup, including self-healing any install that was already affected. New installs get the correct layout from the start, and existing ones repair themselves on the next restart.

---

## Version 0.1.37 — 2026-06-01

### Fixed: Exchange Online & Compliance monitoring now sets itself up during onboarding

Several of Panoptica365's security readers use Exchange Online and Microsoft Purview, which require two Entra directory roles — **Exchange Administrator** and **Compliance Administrator** — to be assigned to the app in each customer tenant. Granting admin consent creates the app and its permissions but does **not** assign these roles, so previously they had to be added by hand in every tenant — and if they were missed, the Exchange/Purview readers stayed stuck at "Awaiting Infra."

Panoptica365 now assigns these two roles automatically right after a tenant grants admin consent, using a permission it already holds. No manual portal step per customer.

If the automatic assignment doesn't take the first time — for example, when the app's service principal is still propagating in a brand-new tenant — you can retry from **Tenants → Edit → Re-assign Exchange roles** (administrators only). The action is safe to run more than once.

---

## Version 0.1.36 — 2026-06-01

### New: delete a tenant and all its data

You can now remove a tenant from Panoptica365. This is useful when an MSP loses a customer, or when you want to remove and re-add a tenant to re-run onboarding.

In the **Tenants** section, click **Edit** on a tenant and you'll find a red **Delete Tenant** button (visible to administrators only). It opens a confirmation that spells out exactly what will be removed — alerts, snapshots, security settings, Conditional Access assignments, audits, and change history. Click **No, keep it** to back out, or **Yes, delete everything** to permanently remove the tenant and all data related to it. The deletion is recorded in the audit log.

This action cannot be undone.

---

## Version 0.1.35 — 2026-06-01

### Fixed: software update progress sometimes reported a false failure

When applying an in-app update, the progress dialog could briefly show "the update did not complete" even though the update was actually succeeding in the background. This happened when a status record from a previous update attempt was still on disk — the dialog read that older record for a moment before the new update overwrote it.

The progress dialog now tracks the specific update it started and ignores any leftover status from an earlier attempt, so it always reports the outcome of the update you actually triggered.

---

## Version 0.1.34 — 2026-06-01

### Clearer Entra app registration setup instructions

The in-wizard Entra app registration guide now lists all three redirect URIs your app needs — not just the sign-in one. Earlier installs registered only the sign-in URL, which worked for logging in but caused Microsoft to reject the very first customer-tenant onboarding with an "AADSTS50011: redirect URI does not match" error. The setup page now shows the two additional URLs — one for onboarding customer tenants, one for the Microsoft Teams configuration features — each with a copy button and the exact place to add them.

The API permissions step is also far clearer about where each permission lives. Microsoft Graph permissions sit on one tab, but the Exchange Online, Office 365 Management, and Microsoft Teams permissions are on a different one (`APIs my organization uses`) and have to be searched by name. The wizard now spells out which tab to use for each API, gives the exact name and Application ID to search for, points out that the Teams `user_impersonation` permission hides inside a collapsed `Other permissions` group, and explains what to do if an API doesn't appear at all on a brand-new tenant.

---

## Version 0.1.33 — 2026-06-01

### Certificate setup reliability fix

A follow-up to the guided certificate setup introduced in 0.1.32. On some fresh installs the certificate could not be generated because the folder it was being written to was not writable, and the **Download certificate** button's label was hard to read. Both are fixed: Panoptica365 now always writes the certificate to a writable location, and the button is legible. No action is needed beyond installing this update.

---

## Version 0.1.32 — 2026-06-01

### Guided certificate setup for Exchange Online monitoring

New installs now provision the certificate that Exchange Online monitoring requires, right inside the setup wizard. Previously a fresh install could read most of your tenants' security posture through Microsoft Graph, but the two dozen settings that depend on Exchange Online PowerShell stayed greyed out as "Awaiting Infra" — because Exchange, unlike Graph, refuses a client secret and insists on a certificate, and nothing created one for you.

The App Registration step of the wizard now has a new **Upload the Monitoring Certificate** section. Panoptica365 generates the certificate for you automatically; you simply click **Download certificate (.cer)**, upload that one file to your app registration's **Certificates & secrets** page in the Microsoft portal, and continue. No `openssl`, no thumbprint typing, no shell access. The **Test Connection** button on the next step now also confirms the certificate was uploaded correctly and tells you plainly if it is missing.

This affects new installs only — existing installs already set their certificate up during onboarding and are unchanged.

---

## Version 0.1.31 — 2026-05-31

### One-click software updates with automatic rollback

Panoptica365 can now update itself. When a newer version is published, every operator sees a calm banner letting them know it's available, and an administrator can apply it with a single click from the account menu — no terminal, no `docker` commands, no shell access required.

When you click **Update now**, Panoptica365 takes a safety snapshot of its database, downloads the new version, swaps it in, and confirms the new version comes up healthy before declaring success. If the new version does **not** come up healthy, it is **automatically rolled back** to the version you were running, and you are told clearly what happened — your instance is never left in a broken state. The database is never automatically restored; the snapshot is kept purely as insurance.

The update banner is shown to everyone, but only administrators see the **Update** action. A required update is flagged with firmer wording, but applying it is always a deliberate administrator choice. Every update attempt — success, rollback, or failure — is recorded in the audit log.

---

## Version 0.1.30 — 2026-05-31

### Fixed: fresh-install setup now sticks — and finishes on its own

The first thing you do on a brand-new Panoptica365 server is run the setup wizard. Until now, on a fresh containerized install the wizard could appear to succeed while the credentials it collected — your Entra app registration, your license key, and the rest — silently failed to persist, leaving the app unable to sign you in. Setup is now rock-solid: everything the wizard collects is saved on the host and survives container restarts and image upgrades.

The final step also finishes by itself. When you complete the wizard, Panoptica365 restarts once to apply your configuration, shows a brief **"Finishing setup — reconnecting…"** screen, and then takes you straight to sign-in (or admin consent) the moment it's back — no terminal commands, no manual restart.

This is the headline fix for first-time installs. If you configured an earlier install by hand, nothing changes for you.

### Also in this release

- The main console's first-run empty states — "no tenants yet" and "no daily summary yet" — now appear in your interface language (English, French, or Spanish) instead of always in English.
- Hardened an internal database migration so a fresh install no longer logs transient warnings while it warms up.

---

## Version 0.1.29 — 2026-05-31

### New: brand your reports with your own name and logo

Panoptica365 reports can now carry your branding instead of ours. A new **Report Branding** card under **Settings** lets you set your company name and upload a logo. A transparent PNG works best — it sits cleanly on the report cover with no white box behind it.

Your logo now appears on the cover of every report — Security Posture, Configuration Documentation, and Quick Assessment — in the upper-left, with the title, client name, and date neatly left-aligned beneath it. The cover's "Prepared by" line shows the name of whoever generated the report rather than a generic company name, so a salesperson can hand a customer a report with their own name on it. Your company name still anchors the confidential footer on every page.

If you don't upload anything, reports keep the default Panoptica365 cover.

---

## Version 0.1.28 — 2026-05-31

### New: Identity timeline — one click from an alert to the whole story

When an identity alert fires — most often an account lockout from repeated failed sign-ins — the question is always the same: was this a forgotten password and a harmless spray from abroad, or the one time an account actually got taken over? Until now, answering it meant leaving the alert, opening Daily Activity, picking the tenant, and hand-filtering that user's sign-ins.

The new **View identity timeline** button, on any identity alert's detail panel, collapses that into one click. A read-only panel slides in showing that user's last 24 hours of activity (widen to 7 days) stitched together from four sources Panoptica365 already collects — sign-ins, the Unified Audit Log, Defender incidents, and other Panoptica alerts — on a single time-sorted screen. Successful and failed sign-ins are colour-coded so a lone success in a wall of failures is impossible to miss, repeated bursts of the same action are folded into one line with a count, and every IP is labelled IPv4 or IPv6.

At the top, Claude reads the whole picture and writes a short plain-language assessment — is this a brute-force attempt the account held against, or a possible compromise that needs action — citing the exact events it relied on. Failed-only attacks are called out plainly as "the account held," not dressed up as breaches. The assessment is written in your interface language and cached, so re-opening the same alert costs nothing; press **Re-analyze** to refresh it. Panoptica365 never touches the tenant: the panel is read-only, with links out to the Learn Hub and the Entra and Defender consoles for when you want to act.

---

## Version 0.1.26 — 2026-05-30

### New: Applications tab — know every app in a tenant, and catch the ones that change

Every Microsoft 365 tenant accumulates consented applications — third-party tools someone clicked "accept" on, plus app registrations created for scripts and integrations. Over time nobody remembers what half of them are, and any one of them can be holding standing access to mail, files, or the directory. The new **Applications** tab, in each tenant's dashboard between Alerts and CA Policies, lists them all in one place, shows exactly what each one can do, and lets you mark the ones you recognise as **Known good**.

Marking an app Known good snapshots its current permissions as a baseline. From then on Panoptica365 watches that app and warns you only if it later **gains** permissions beyond what you approved — the same accept-the-drift model you already use for Conditional Access. Removing permissions never alerts; only growth past your baseline does, because growth is the direction that adds risk. A drifted app raises a single **Known-good app drift** alert with a full plain-language explainer.

The apps you haven't reviewed get a one-time triage assessment from Claude (Sonnet): a green, yellow, or red dot telling you where to start. Expand any app to read Claude's full reasoning, its permissions grouped by type, and its history. The dot is triage, never a verdict of "safe" — only marking an app Known good stores a protected baseline.

When you mark an app Known good, any open OAuth-consent alert for it resolves automatically, and that alert now links straight to the app's row. Panoptica365 still never changes a tenant itself: when you want to remove a dead app, each row has a **Delete** link that opens that exact app in the Entra admin centre, where you confirm the deletion (Microsoft keeps it restorable for 30 days).

### Fixed: the Overview app lists now show every app

On the tenant Overview, the **Enterprise applications** and **Registered applications** panels used to show only the first 30 rows with a silent "+N more" — an incomplete security list that looked complete. They now show every app in a scrolling list, and the enterprise-app count matches what you see in the Entra portal.

---

## Version 0.1.25 — 2026-05-30

### New: Microsoft message feed — get warned when Microsoft moves the floor

There's a third kind of configuration drift, and until now Panoptica365 only
watched two of them. You already get alerted when an operator changes
something (operator-caused drift) and when an attacker changes something
(attacker-caused drift). The one you couldn't see was Microsoft quietly
changing a default, retiring a control, or narrowing who a policy applies to —
**Microsoft-caused drift**. Nobody touched the tenant; the setting just stopped
meaning what it meant last week, and there's no sign-in to investigate and
nothing in the audit log.

The new **Microsoft message feed** closes that gap. Pick one tenant in
**Settings → Microsoft message feed** (your own MSP tenant or any onboarded
customer — it's the same Microsoft roadmap either way), and once a day
Panoptica365 reads that tenant's Microsoft 365 Message Center, sends each new
announcement to Claude, and raises an alert **only when the change looks like it
affects a setting we already monitor for you**. Most Message Center posts are
noise; this surfaces the handful that matter, usually with weeks of lead time so
you can adjust on your own schedule instead of finding out when something breaks.

These alerts are **MSP-wide**, not tied to a single customer. One Microsoft
change that touches your whole book of business produces **one** alert that
lists the affected tenants by name — never a dozen near-identical ones. Each
alert carries a plain-language explanation in your language, a link straight to
Microsoft's original post, and the graduation-cap explainer if you want the full
"why this matters" writeup. The feature ships **off** — nothing happens until you
choose a source tenant, and you can switch it or turn it back to None at any time.

By default these alerts are **dashboard-only** — they appear in the Alert
Dashboard but are not emailed, since Microsoft-caused drift is awareness-grade,
not an incident. If you'd rather be emailed too, switch the **"Microsoft planned
change"** alert policy to support/personal/both. And the first time a source
tenant is read, its entire historical Message Center backlog is brought into the
dashboard at once without emailing you, so enabling the feed never floods your
inbox.

This needs one new Microsoft permission, `ServiceMessage.Read.All`, granted on
the tenant you read from. New installs pick it up in the setup guide; existing
installs grant it once on the chosen source tenant.

---

## Version 0.1.24 — 2026-05-30

### New: Heatmap — every tenant's security posture, side by side

A new **Heatmap** page joins the Console section (just above Tenants). It
shows every managed tenant's security posture across the same categories —
Identity, Email & Exchange, SharePoint, Teams, Compliance — in one grid, so
you can spot at a glance which control is weak across the whole book of
business and run a single "fix it everywhere" campaign.

Each category cell shows a row of status dots, one per control, colored by
the control's real state: green (healthy), red (drifted), amber (not set up
yet), a neutral striped dot (not available on that tenant), and a textured
dot (no data yet). Click a category header to expand it into its individual
controls, and click any tenant, cell, or dot to jump straight to that
tenant's Security detail page. The whole page is read-only — it never changes
anything on a tenant.

Above the grid: a fleet-wide health percentage, a "Universally weak" panel
ranking the controls that are weak at the most tenants (click one to see the
affected tenants and the control's write-up), and a "Movers" panel that will
highlight which tenant regressed most over a rolling 7-day window. The Movers
panel shows a "collecting baseline" message until a week of daily history has
accrued, then begins reporting real trends.

The headline percentage under each tenant name reads as "healthy ÷ applicable
controls" and now shows the raw fraction too — e.g. **100% (17/17)** — so it's
clear it means "of the controls that apply to this tenant, this many are
healthy," not a share of every control Panoptica365 offers. Audit-only tenants
are excluded everywhere, with a caption in the header explaining the count
difference versus the Tenants list.

The Heatmap reads the same per-control verdicts that drive each tenant's
Security page, so the two can never disagree. It is available to all user
tiers (admin, operator, viewer) and is fully localized in English, French,
and Spanish.

---

## Version 0.1.23 — 2026-05-30

### Alert accuracy: no more false waves from failed polls

When Panoptica checks a tenant, it compares what it sees now against what it
saw last time, and alerts you on the difference — a new enterprise app, a
deleted inbox rule, and so on. The problem: if a check hit a momentarily
throttled or unavailable Microsoft API, Panoptica could read the tenant's
inventory as briefly *empty*, store that empty reading, and then — on the next
healthy check — flag the tenant's **entire** inventory as newly created (or, if
it flipped the other way, entirely deleted). The result was a burst of false
alerts, often stamped with the object's original creation date months or years
ago.

Failed checks no longer overwrite good data. When a fetch fails or comes back
incomplete, Panoptica now keeps the last known-good picture instead of storing
an empty one, so a transient Microsoft hiccup can't manufacture a wave of
phantom "created" / "deleted" alerts.

### MFA alerts now name the user

"MFA not registered" alerts previously showed `undefined` instead of the
person's name, and collapsed every affected user into a single alert. They now
show the actual user and track one alert per person.

### Reports exclude dismissed alerts

Alerts you mark as **false positive** no longer count toward the numbers in PDF
reports, the morning briefing, or the dashboard tiles. Alerts you mark
**resolved** still appear — a resolved alert is real security history, and your
reports should reflect it.

---

## Version 0.1.22 — 2026-05-29

### New: Learn — the built-in security curriculum

Panoptica365 now has a **Learn** section in the sidebar (under SharePoint).
It brings the full security curriculum directly into the console: 49 lessons
across six topics — from an orientation to the Microsoft 365 security
landscape, through the real-world identity attacks hitting tenants today, to
Conditional Access, Intune, email security, and Secure Score.

Click **Learn** to see the six topic cards, open a topic to browse its
lessons, and click any lesson to read it in a large, comfortable reading
view. A blue dot marks lessons you haven't read yet — it clears once you open
them — and an **UPDATED** badge flags lessons changed in the last two weeks,
so you can tell at a glance what's new. Everything follows your interface
language: English, French, or Spanish.

The whole section is read-only. It's there to learn from, whether you're
bringing a new technician up to speed or brushing up on a specific control
before you configure it.

---

## Version 0.1.21 — 2026-05-29

### Quick Assessment now runs on Claude Opus 4.8

The Quick Assessment report — the deep, AI-written gap analysis of a
tenant's security posture — now uses Anthropic's latest top-tier model,
Claude Opus 4.8, released this week. Previously it was pinned to Opus 4.7.

This is a model upgrade only: nothing changes in how you generate an
assessment or what the report covers. Opus 4.8 brings stronger reasoning
and more accurate analysis, so expect tighter, better-prioritized findings.
The model can still be overridden per-install via the `OPUS_MODEL`
environment variable for operators who want to pin a specific version.

---

## Version 0.1.20 — 2026-05-28

### Tenant dashboard: Intune device counts now reconcile

The tenant dashboard had three different device counts that didn't agree:
the **Devices** stat card (total Entra-registered devices), the
`X/Y compliant` subtitle under it (devices with a compliance verdict
recorded in Entra), and the **Intune Managed Devices** table count (devices
enrolled in Intune). Entra and Intune track different populations — Entra
counts every device that ever registered with the directory, Intune only
counts devices currently enrolled in MDM — so the three numbers were each
correct in isolation but looked contradictory side-by-side.

The Devices and Managed stat cards have been replaced with a single
**Compliant Devices** card. It shows the percentage of Intune-evaluable
devices that are compliant — the only source where Microsoft actually
produces a per-device compliance verdict. The subtitle reads
`X of Y compliant` plus `Z not evaluated` when any devices fall into the
not-evaluated bucket (typically servers managed by Defender for Endpoint
rather than Intune). Servers on MDE no longer drag the score down — they
simply aren't part of the percentage.

A small trend arrow appears next to the percentage when the compliance
score has changed since the previous poll: green `▲ +N%` if it improved,
red `▼ −N%` if it regressed, nothing when it's flat or this is the first
poll. Trend is computed per tenant per poll cycle and embedded in the
`intune_compliance` metric snapshot.

### Tenant dashboard: Intune table shows every device

The **Intune Managed Devices** panel was capped at 30 rows with a
`... and N more` placeholder — useless on tenants with 100+ devices.
The panel now renders every device in a scrollable container (≈25 rows
visible, the rest reachable by scroll) with a sticky header. The
**Compliance** column shows `Compliant`, `Non compliant`, or
`Not evaluated` instead of Microsoft's raw eight-state vocabulary
(`unknown`, `inGracePeriod`, `conflict`, `error`, `notAssigned`,
`configManager`, etc.). The bucketing rules: `compliant` and
`inGracePeriod` count as compliant (Microsoft itself treats grace-period
devices as compliant for CA purposes); `noncompliant`, `conflict`, and
`error` count as non compliant; everything else is not evaluated.

### Tenant dashboard: Total Users subtitle now adds up

The **Total Users** card subtitle previously read
`{licensed} licensed, {guests} guests` — which silently excluded
unlicensed members from the breakdown, so the two numbers didn't add
up to the total (e.g. a tenant with 58 users would show
`8 licensed, 40 guests`, leaving 10 unlicensed members invisible).
The subtitle is now `{licensed} licensed, {unlicensed} unlicensed,
{guests} guests` so the three numbers always reconcile to the total.

The `licensed` count in the subtitle now excludes licensed guests —
useful for understanding the in-house workforce sizing. The platform's
internal seat-billing telemetry to the license server is unchanged
(still counts all licensed users regardless of guest/member); only the
dashboard subtitle was tightened.

---

## Version 0.1.19 — 2026-05-25

### Fix: auth.js MSAL instantiation is now lazy

A truly fresh install (installer + empty `ENTRA_CLIENT_SECRET` in `.env`
until the wizard collects it) was crashing the app at boot, before
`setupMiddleware` could redirect the user to `/setup`. Root cause: MSAL's
`new ConfidentialClientApplication(...)` was called at module-load time
in `src/auth.js` and throws `invalid_client_credential` on an empty secret.

The single MSAL client is now constructed lazily via `getCCA()` on first
use. The module loads cleanly with empty Entra config; any auth-route
call before setup completes fails with a clear "complete the setup wizard
at /setup first" error instead of crashing the process. The `cca` export
is replaced by `getCCA` (no external callers were using `auth.cca`).

This was the last bug blocking the
`curl install.panoptica365.com/run` → Docker stack up → walk the wizard
→ land on Main Console flow. Surfaced by the Stage 4 Part A end-to-end
test on P365-Test, which is the first install path that ever exercised
a truly-empty Entra config at boot.

---

## Version 0.1.18 — 2026-05-25

### Wizard: Hostname step dropped (now 7 steps)

The first-boot wizard no longer prompts for hostname + Let's Encrypt email.
Those values are now collected by the Stage 4 installer at
`install.panoptica365.com/run` BEFORE the Docker stack comes up — so Caddy
provisions TLS from boot, and the operator goes straight to the
`https://<hostname>/setup` URL with valid TLS already in place. Wizard
goes from 8 steps to 7: Welcome → App Registration → Entra Credentials →
SMTP → Anthropic → License → First Tenant.

Existing installs already past setup are unaffected. Installs that ran
the v0.1.10–v0.1.17 wizard previously have hostname marked complete in
their setup state; the new step list still respects the
`setup-completed-once.flag` backstop. The legacy `/api/setup/hostname`
endpoint stays in `api-setup.js` for backward compat but is no longer
called by the frontend.

---

## Version 0.1.17 — 2026-05-25

### Main console: tenant search box

The tenants panel on the Main Console now has a search box just below the
header. Start typing any part of a tenant's display name — the list
filters in real time, case-insensitively, on substring match. Useful when
an MSP has dozens (or hundreds) of customers and needs to jump to one
quickly without scrolling.

- **Substring, not prefix.** Typing `CAE` matches every tenant with
  "CAE" anywhere in the name, not just those starting with `CAE`.
- **Case-insensitive.** `cae` and `CAE` and `Cae` all return the same
  matches.
- **Clear button + Esc.** A `×` button appears in the search bar when
  there's an active filter; clicking it clears the input and restores
  the full list. Pressing Esc while focused in the search box does the
  same.
- **Survives auto-refresh.** The tenant panel re-fetches scores every
  5 minutes; your filter and what you've typed are preserved across the
  refresh.
- **Counter reflects the filter.** The header count switches from
  "12 tenants" to "3 of 12 tenants" while filtering, so it's obvious
  how much of the full list is being hidden.

Localized en/fr/es.

---

## Version 0.1.16 — 2026-05-25

### CA auto-remediation retired — safety fix

The Conditional Access drift checker no longer auto-PATCHes live policies
back to template state, even on assignments that were previously set to
"Monitor + Remediate". This is a safety fix.

**Why.** The `NON_REMEDIABLE_FIELDS` denylist added in April was supposed
to keep per-tenant `excludeUsers` / `excludeGroups` lists safe by omitting
those fields from the PATCH body. But Microsoft Graph PATCH semantics on
a nested object (`conditions.users`) **replace the whole sub-object** with
whatever is sent — so omitting `excludeUsers` caused Graph to clear it to
an empty array. Confirmed in production on 2026-05-25: nine user-exclusions
were wiped across five tenants in a single drift cycle right after v0.1.15
enabled drift detection on the Canada-only template's exclusion list.

**What changes.**

- The hourly drift scheduler now only **detects** drift and fires alerts.
  It never PATCHes a live policy. The `enforcement` column is preserved
  for backward compatibility but is no longer read by application code.
- The **SWITCH TO MONITOR / SWITCH TO REMEDIATE** toggle is removed from
  the CA assignment tile. The "Enforcement" row is also removed.
- The previous "REMEDIATE" button on a drifted assignment is renamed to
  **PUSH TEMPLATE** and is now styled as a destructive action. The confirm
  dialog explicitly warns about the `excludeUsers` / `excludeGroups` wipe
  semantics so an operator can't be bitten without consent.
- The Assign-Template modal no longer asks for an enforcement mode — all
  new assignments are created in monitor mode by default.

**Operational model going forward** (now matches Intune Deployments):
drift is detected → alert fires → operator either clicks **Accept Drift**
to acknowledge the per-tenant variation as intentional (orange ACCEPTED
state, hash-suppressed) or clicks **Push Template** to explicitly
overwrite the live policy with the template state, accepting the wipe.

**For affected tenants**: nine user-exclusions across Calogy Solutions,
Dienamex, Tatum, Thymox, and Trilogiam were wiped during the v0.1.15
incident window. Panoptica365's own `ca_drift_log` table preserves every
wiped GUID in `actual_value`, so restoration is a copy/paste back into
the Entra portal's user picker. Operator action required.

---

## Version 0.1.15 — 2026-05-25

### CA drift detection: exclusion-list changes are now caught

Adding or removing a user/group from a Conditional Access policy's
**excludeUsers** or **excludeGroups** list was silently invisible to drift
detection on some templates — the comparator never compared those fields
because they weren't in the template's monitored field list. An operator
adding an excluded user to a deployed CA policy (e.g. "Only allow access
from Canada") would see no drift, no alert, no entry on the CA tile.

The fix backfills `conditions.users.excludeUsers` and
`conditions.users.excludeGroups` into every CA template's monitored fields
on server startup. Idempotent — templates that already had them are
untouched. The same defaults already applied to *new* template imports
since the exemption-aware drift work shipped, but the backfill for
pre-existing templates only lived in a manual SQL migration that wasn't
wired into boot — meaning fresh installs and any post-fix imports could
land in the broken state. Now both paths converge.

After upgrading, the next drift cycle (or a manual "Check Drift" on the
CA tile) will correctly detect exclusion-list changes and fire the
informational "CA Exemption List Changed" alert, which you can then accept
as an intentional exemption or push back via the live policy.

---

## Version 0.1.14 — 2026-05-24

### App Registration modal: bold tags render + no more duplicate copy icon

Two small fixes caught during v0.1.13 P365-Test verification:

- Three bullets in the modal (steps 3.5, 3.6 about the client secret,
  and step 1.5 about clicking Register) were rendering `<strong>Add</strong>`,
  `<strong>Value</strong>`, and `<strong>Register</strong>` as raw HTML
  text instead of bolding the words. Same fix as v0.1.12 — flipped the
  three `data-i18n` attrs to `data-i18n-html`.

- The permission rows in the modal had two copy icons side-by-side per
  row. Caused by passing the icon character as the button's display text
  in addition to the always-present icon span. Now uses a dedicated
  icon-only copy button helper.

---

## Version 0.1.13 — 2026-05-24

### Wizard: full Entra app registration walkthrough + Test Connection

The Entra step in the first-boot wizard was the longest manual chunk of
the install — operators had to know to create the app reg themselves
with the right multi-tenant setting, the right ~58 permissions, admin
consent, and the two RBAC roles for PowerShell modules. Easy to miss
something and find out months later when a feature silently doesn't work.

This release adds a dedicated **App Registration** step with a large
modal containing detailed click-by-click instructions:

- The complete 58-permission catalog (47 Microsoft Graph application
  + 6 delegated, 1 Exchange Online, 2 Management APIs, 2 Skype/Teams),
  ordered to match the Entra portal's UI, with a copy-icon on every
  permission name (plus a "copy all" button per category).
- The hostname-derived redirect URI as a one-click copy.
- Step-by-step Service Principal role assignments (Exchange Administrator
  + Compliance Administrator), with explicit warnings against the
  similarly-named "Exchange Recipient Administrator" / "Compliance Data
  Administrator" roles that look right but won't work.
- Guidance for creating the three RBAC groups (Panoptica365 Admins /
  Operators / Viewers) with suggested names that match Panoptica365's
  internal role naming, plus copy buttons.
- Color-coded callouts: red for "do NOT" footguns, amber for
  easy-to-miss steps, green for "you should see this" confirmation cues.
- "I already have an app reg — skip" link for operators who provisioned
  via PowerShell or are reinstalling.

The credentials paste step now has:

- Three group ID fields (Admins / Operators / Viewers) instead of just
  the admin one, with admin marked recommended and the other two
  optional.
- A **Test Connection** button that acquires an app-only token + fires
  ~9 representative Graph calls in parallel. If the token request fails
  it diagnoses common Microsoft error codes (AADSTS7000215 = wrong secret
  value pasted, AADSTS90002 = wrong tenant ID, etc.). If the token works
  but Graph calls 403 it lists exactly which permissions are missing
  (the most common cause is "forgot to click Grant admin consent").
- A "Reopen App Registration instructions" link in case the operator
  needs to double-check a step.

Fully localized en/fr/es.

---

## Version 0.1.12 — 2026-05-24

### Wizard: embedded links and code spans now render properly

A handful of wizard descriptions reference Entra (entra.microsoft.com),
the Anthropic console, sample hostnames, and the `PNX-...` activation
key format. Those `<a>` links and `<code>` snippets were being shown
as raw HTML text. The renderer now uses the correct innerHTML pathway
for i18n keys that contain markup.

(Caught while verifying the v0.1.11 wizard polish on P365-Test.)

---

## Version 0.1.11 — 2026-05-24

### Wizard polish

Two small fixes caught during the v0.1.10 end-to-end verification on
P365-Test:

- **Back button now preserves entered values.** Form fields (including
  the long Entra GUIDs, SMTP host / username / password, Anthropic key,
  and license activation key) are no longer wiped when you click Back.
  Values are remembered across step navigation within the same wizard
  session.

- **Header banner refit.** The wizard now has a full-width chrome
  banner along the top with a prominent Panoptica365 logo and the
  language picker, matching the visual style of the main app's header.
  Replaces the small floating logo that was hard to see on the dark
  background.

---

## Version 0.1.10 — 2026-05-24

### First-boot setup wizard

Fresh installs now boot into a guided 7-step web wizard instead of
requiring hand-editing of `.env` and a manual license-activation `curl`
call. The wizard walks operators through hostname + TLS, Entra app
registration, SMTP with test send, Anthropic API key with test call,
license activation against the license server, and an optional
first-tenant onboarding.

Existing installs are detected automatically — if a valid `LICENSE_TOKEN`
is already present in `.env`, setup is marked complete retroactively and
the wizard never appears. No action required for current operators.

The wizard is fully localized in English, Quebec French, and Spanish.
Operators choose language via the picker in the top-right; the choice
carries over to their operator preferences after setup completes.

---

## Version 0.1.9 — 2026-05-24

### Container images now pull from GitHub Container Registry

Fresh customer installs no longer build the Panoptica365 image from source.
The published Docker image is now publicly available at
`ghcr.io/panoptica365/app:latest`, and `docker-compose.yml` pulls it
directly. This is the prerequisite for the Stage 4 installer
(`install.panoptica365.com/run`, shipping shortly) — a one-line install
command can stand up a working Panoptica365 stack on a fresh Ubuntu host
in minutes, no developer build environment needed.

Existing installs see no behavior change. If you're iterating on local
source for dev purposes, the compose `build:` block is preserved —
`docker compose build && docker compose up` still works exactly as before.

---

## Version 0.1.8 — 2026-05-24

### Licensing enforcement

Panoptica365 now requires a valid license token to run. Every install
activates once against `license.panoptica365.com` to exchange an activation
key for a signed token, then refreshes that token weekly to stay current.
The license server is only contacted for activation and refresh — day-to-day
verification is fully offline, so a license-server outage cannot take down
your install.

Activation is one-time per install. After your installer (or `curl` against
`/api/v1/activate`) lands the token in `.env`, the boot path verifies it and
keeps a backup copy in `data/state/license-cache.json` so an accidental `.env`
wipe never costs you uptime.

### Expiry banner

If a paid license passes its expiry, a top-of-page banner surfaces — amber
for the 14-day warning period, slightly darker for days 15-21 when new
tenants, Intune templates, and Conditional Access templates can no longer
be created, then red for day 22+ when the install enters read-only mode.
NFR licenses never see the banner because they are perpetual by design.

The banner copy and the **Contact license@panoptica365.com** call-to-action
are fully localized in English, Quebec French, and Spanish.

### What does NOT change

Existing alerts, polling, drift detection, security settings, reports, and
every other feature continue exactly as before. Licensing is a thin layer
at the boot path plus a middleware gate — it does not touch operational
behavior on a healthy license.

---

## Version 0.1.7 — 2026-05-22

### See what's new — in the app

The header now has a **What's New** menu (click your name in the top-right).
Each release puts its highlights one click away — the latest version is shown
by default, with an **Earlier releases** expander for the full history.

You also get a small unread dot on your name whenever there's a release you
have not read yet, and a one-time toast on first load after an update — so a
new version never slips by unnoticed.

Two other small additions in the same area: the **Log out** button has been
folded into the same dropdown menu (alongside Preferences), and the current
app version is now shown at the bottom of the left sidebar.

---

## Version 0.1.6 — 2026-05-22

### New report — Quick Assessment

A new report type is available under **Reports → Quick Assessment**. Where the
Configuration Documentation report is a pure data snapshot, the Quick
Assessment is an *advisory* report: it takes a tenant's current configuration
and runs it through an in-depth AI analysis that highlights strengths,
weaknesses, and — most importantly — **what is missing**.

It reviews Conditional Access, Intune, and the full security-settings posture,
and calls out gaps against Microsoft's recommended baselines: missing
Conditional Access policies, absent or weak Intune policies, security settings
that have drifted from their recommended state. Where Panoptica365 already has
a template that would close a gap, the recommendation is flagged as a one-click
deploy — and a gap is still reported even when no template exists for it.

When you click **Generate Report**, a box appears where you can add free-text
context for the analysis — the customer's business type, known concerns,
anything the analysis should weigh (you can paste in notes). The report is a
point-in-time snapshot — no date range — and it is available for audit-only
tenants, which makes it a natural deliverable for a trial engagement.

### "Poll Now" no longer reports a false timeout

Triggering an on-demand poll of a tenant — especially a newly added one,
where the first poll has to fetch everything — could show a
"Poll failed: HTTP 504" error even though the poll was still running and
went on to finish successfully.

On-demand polls now run in the background. The poll starts immediately, the
dashboard keeps its "Polling…" state, and the page refreshes on its own the
moment the poll completes (or reports a clear error if it genuinely fails).
A long-running poll can no longer trip a gateway timeout.

### PDF reports now generate on server installations

Generating a tenant Documentation or Security Posture report could fail on a
server install with a "No module named …" error — the installer did not
provision the Python libraries (ReportLab, matplotlib) that the PDF
generators depend on. The setup script now creates a dedicated Python
environment with those libraries, so PDF report generation works out of the
box on a fresh install.

### Adding a new tenant is now reliable on the first attempt

Onboarding a brand-new tenant could fail on the first attempt with a consent
error — the Panoptica365 app ended up registered in the customer tenant with
its permissions granted, but the tenant did not appear in your tenant list,
so you had to run **Add Tenant** a second time before it showed up.

The cause was Microsoft's admin-consent endpoint intermittently failing the
redirect when permissions for two different APIs (Microsoft Graph and the
Teams administration API) were requested in a single consent — even though
the consent itself succeeded. Add Tenant now requests them as two separate
consent steps: the first registers the tenant, the second grants the Teams
administration permissions. A first-attempt failure no longer happens. You
will see two Microsoft consent screens during Add Tenant instead of one, and
the tenant is saved after the first one regardless of the second.

---

## Version 0.1.5 — 2026-05-21

### Cleaner audit-only tenant deletions

When an audit-only tenant reaches the end of its 21-day lifecycle and is
automatically cleaned out of Panoptica365, the operator receives a summary
email confirming what was removed. Previously, that email could include a
spurious "1 error during cascade" warning that referred to a global rules
catalog table the cleanup never needed to touch. The warning was visually
alarming but had no impact on the actual cleanup.

The cleanup inventory has been corrected. Future audit-only tenant deletions
will report zero errors in the summary email — what you see in the email now
matches what actually happened.

### Audit-Only Tenant Mode design doc updated

The design document at `Documentation/Audit-Only-Tenant-Mode.docx` has been
extended with a status appendix as of 2026-05-21. The appendix records
end-to-end production validation on the first paying audit-only tenant
(consent → polling → snapshot export → 14-day warning email → 21-day
cascade delete + revocation reminder), the integration sweep added on
Apr 29 to gate alerts/AI/notifications/health-checks against audit-only
tenants, the live-Graph extraction added to the snapshot bundler the
same day, and the cascade-inventory fix above.

---

## Version 0.1.4 — 2026-05-21

### Quick tenant switching from the dashboard

The tenant dashboard header now includes a **tenant switcher** — a dropdown
listing all of your tenants, in the spot where the tenant name used to be.

- Jump straight from one tenant's dashboard to another without going back to
  the main console and picking a tenant from the list.
- Your current tab is kept across the switch. If you're looking at **Intune
  Policies** for one tenant, choosing another tenant takes you directly to
  that tenant's **Intune Policies** — and the same goes for the Overview,
  Alerts, CA Policies, and Change Log tabs.

This removes several clicks from the common task of reviewing the same area
across multiple tenants.
