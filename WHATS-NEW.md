# What's New in Panoptica365

Customer-facing release notes. Each version below describes what changed in
that release, newest first.

---

## Version 0.1.11 — 2026-05-24

### Wizard polish

Three small fixes caught during the v0.1.10 end-to-end verification on
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

- **Embedded links and code spans now render properly.** A handful of
  wizard descriptions reference Entra (entra.microsoft.com), the
  Anthropic console, sample hostnames, and the `PNX-...` activation key
  format. Those `<a>` links and `<code>` snippets were being shown as
  raw HTML text. The renderer now uses the correct innerHTML pathway for
  i18n keys that contain markup.

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
