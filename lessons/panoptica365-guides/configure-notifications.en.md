---
title: "Configure notifications"
subtitle: "SMTP, recipients, the 6 AM briefing, and mute periods — how alerts reach humans, reliably."
icon: "mail"
last_updated: 2026-06-07
---

# Configure notifications

An alert nobody receives didn't happen. This guide wires up the delivery side — it's all in **Settings** (Admin role required), and it's worth doing carefully once.

## SMTP — the foundation

**Settings → SMTP Settings.** Host, port, username, password, and the From address. Save, then use **Send Test Email** — actually do this; the test catches the auth typo or blocked port *now* rather than during your first real incident. Every email feature in the platform (alert notifications, daily briefing, report-adjacent mail) rides on this configuration.

## Recipients and routing

**Settings → Notification Settings** holds three fields:

- **Recipient Email Addresses** — the comma-separated list of *personal* recipients: your operators. Alerts whose policy routes to **personal** (or **both**) go here.
- **PSA Email Address** — where **support**-routed alerts go when they travel by email: your PSA's email-to-ticket intake. Once the native PSA integration is connected (next guide), support-routed alerts become real API tickets and this address becomes the fallback — keep it set either way.
- **Attribution String** — the first line of PSA-bound emails, supporting the `${PSA_NAME}` placeholder so your PSA can auto-route tickets to the right company board.

Which alerts go where is decided per alert policy (routing: none / personal / support / both — see *Tune alert policies*). The mental model: **Settings says where the channels point; Alert Policies says what flows down each channel.**

Each recipient gets email in **their own language** — recipients with a Panoptica365 user profile receive alert mail in the language set in their preferences.

## The daily briefing

Every morning at 6, Panoptica365 emails a Claude-written summary of the last day across the fleet. **Settings → Daily Summary** sets the minimum severity that makes it in: from *Info — include everything (default)* up to *Severe only*. Alerts resolved by exemption rules are excluded automatically — the footer notes what was filtered. If your briefing reads like noise, raise the threshold before you stop reading it; a briefing you skim daily at any threshold beats a complete one you ignore.

## Mute periods

Going on vacation? Any user can mute alerts **to their own email**: click your mute control, set From / To (up to 60 days), and optionally a reason. The mute auto-expires; you can cancel it early.

Two honest details:

- Muting only affects *your* delivery. If your address isn't on any recipient list, the UI tells you the mute has no effect.
- **The failsafe:** if every configured recipient is muted simultaneously, Panoptica365 overrides the mutes and delivers to an Admin anyway, with a *Failsafe delivery* banner on the email. There is no configuration in which a severe alert silently reaches no one. Admins can review all active mutes in Settings.

## The checklist

1. SMTP configured and **test email received**.
2. Operator emails in Recipient list; PSA email set.
3. Daily Summary threshold chosen.
4. Alert policy routing reviewed (*Tune alert policies*).
5. A real test: trip something harmless, confirm it arrives where you expect.

Fifteen minutes, once — and then the alert-driven model actually works, because delivery is trustworthy.
