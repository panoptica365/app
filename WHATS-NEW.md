# What's New in Panoptica365

Customer-facing release notes. Each version below describes what changed in
that release, newest first.

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
