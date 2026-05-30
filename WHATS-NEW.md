# What's New in Panoptica365

Customer-facing release notes. Each version below describes what changed in
that release, newest first.

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
