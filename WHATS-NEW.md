# What's New in Panoptica365

Customer-facing release notes. Each version below describes what changed in
that release, newest first.

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
