---
title: "Defender XDR — what it is, what it isn't"
subtitle: "Microsoft's cross-product correlation layer explained: why most MSPs shouldn't have the portal open daily, and what Attack Disruption actually does."
icon: "shield-alert"
last_updated: 2026-05-29
---

# Defender XDR — what it is, what it isn't

Most days, you should not need to open the Defender XDR portal.

That sentence is going to sound wrong if you've just been told (correctly) that Defender XDR is the heart of Microsoft 365 security detection. So let me walk you through why it's both heart and wallflower at the same time.

Defender XDR is Microsoft's cross-product correlation layer — the thing that takes raw security signals from Defender for Endpoint, Defender for Office 365, Defender for Cloud Apps, Defender for Identity, and Entra ID Protection, and tries to turn them into something a human can act on. It is the place where M365 security graduates from "a lot of alerts" to "stories about what happened."

The honest reality of how MSPs use it: most never look at the portal daily, and that's not necessarily wrong. It's a portal Microsoft designed for a SOC analyst to live in, eight hours a day. Most MSPs do not have one of those. So XDR has to be configured to do the work *autonomously* and surface only what genuinely needs eyes. Getting that configuration right is the whole skill.

## What XDR actually means

The acronyms in this space accumulated quickly and the marketing has not helped. Three terms you'll hear:

**EDR — Endpoint Detection and Response.** Watches a single endpoint (a Windows laptop, a Mac, a Linux server) for malicious behaviour. Defender for Endpoint is the EDR. It sees process trees, file hashes, network connections, registry edits, suspicious script chains. It is deep, narrow, and lives on the device.

**XDR — eXtended Detection and Response.** Watches *multiple* surfaces and *correlates* between them. Defender XDR is the XDR. Same idea as EDR, broader scope. When a user clicks a phishing link in Outlook (Defender for Office 365), then a process spawns on her laptop (Defender for Endpoint), then a sign-in happens from a different country (Entra ID Protection), XDR is the layer that ties those three into *one* incident.

**SIEM — Security Information and Event Management.** Not a Microsoft category specifically; it's the wider industry name for log-collection-and-analysis platforms. Microsoft's SIEM is Microsoft Sentinel. SIEM is broader than XDR — it can ingest *anything*: firewall logs, custom application logs, third-party security tools. But SIEM is also more *raw* — it gives you the logs and expects you to write the detections.

The shape of the three:

```
   SIEM    : Raw logs from anywhere. You write the detections.
              ↓ (filtered, correlated)
   XDR     : Microsoft's cross-product incidents. Microsoft wrote
              the detections; you tune and triage them.
              ↓ (focused on one surface)
   EDR     : One surface's deep telemetry. Mostly autopilot.
```

Defender XDR is the middle layer. Inforcer, Octiga, Overe, Panoptica365 — we all live downstream of it.

## Alerts vs detections vs incidents

XDR has its own vocabulary, and it's worth learning it because the words mean specific things.

**Signal.** A raw observation. "Process X spawned on device Y at time T." There are millions of these per day in a typical tenant. Nobody looks at signals directly.

**Detection.** A pattern Microsoft (or your own custom rule) has decided is interesting. "Powershell.exe spawned with encoded command line from a Word document" is a detection. Detections live in the tables you can query with KQL in Advanced Hunting.

**Alert.** A detection that crossed a threshold worth showing in the UI. Alerts come with a severity (informational / low / medium / high) and are routed by category (initial access, lateral movement, exfiltration, etc.).

**Incident.** A *grouping* of alerts that XDR's correlation engine thinks relate to a single attack. An incident might bundle six alerts across email, identity, and endpoint into one story: "User Karen clicked a phishing link → Karen's session cookie was stolen → the cookie was replayed from Eastern Europe → an inbox forwarding rule was created."

The journey of an event is therefore: signal → detection → alert → incident.

A well-configured XDR shows the operator *incidents* and lets them drill *down* to alerts and from there to detections. A badly configured one shows the operator a fire hose of alerts with no correlation, and the operator drowns.

## Why most MSPs don't open the portal daily

Defender XDR is designed for a SOC analyst in a 24/7 monitoring centre. Most MSPs aren't one. So the realistic posture is:

**Attack Disruption handles the worst events automatically.** Microsoft's Attack Disruption capability auto-responds to high-confidence incidents — disables the user, revokes their tokens, contains the device. This happens without an operator clicking anything. By the time an operator looks at the portal in the morning, the worst incidents of the night are already contained.

**Defender for Endpoint Automated Investigation and Response (AIR) cleans up endpoint events.** Suspicious processes get killed and remediated; malicious files get quarantined; the device gets investigated and re-scored. The operator sees a closed incident with a story attached.

**Real-time alerts route to the operator's inbox or PSA.** The high-severity stuff comes out of Defender XDR via webhook or Graph notifications and lands in the operator's normal workflow — Outlook, Teams, the PSA queue, or Panoptica365.

What this means in practice: you should open the Defender XDR portal *deliberately* — usually weekly, sometimes in response to a specific alert — not daily as a habit. The two operational rituals that matter:

**Weekly review.** Scan open and recently-closed incidents across all your tenants. Are there any that closed themselves but you should understand? Any that have been sitting open for more than 48 hours? Any unclassified entries in the incident-grading queue that need disposition?

**Targeted drill-down.** When Panoptica365 (or an email alert, or a customer complaint) points you at a specific user or device, open the Defender XDR portal *for that user* and look at their alerts and incidents. The portal is excellent for one-user-at-a-time forensics. It is bad as a sit-and-watch tool for an MSP managing thirty tenants.

## What Attack Disruption is, and why it's an exception

Attack Disruption deserves its own paragraph because it's the only place in this entire stack where Defender *actively does something* during an attack, rather than passively reporting on it.

It works like this. Defender XDR correlates signals across products and assigns a confidence score to each incident. When that confidence crosses a high threshold *and* the incident type is one Attack Disruption supports — currently AiTM phishing, business email compromise (BEC), human-operated ransomware (HumOR), password spray — the system takes pre-defined actions: disable the user account in Entra ID, revoke their session tokens, contain the device, sometimes contain the device's network connection. The operator doesn't approve these actions. They just happen.

The operator finds out by getting a notification ("a potentially compromised account was disabled automatically by attack disruption") and seeing the closed-with-mitigation badge on the incident.

This is the modern version of "real-time response" — Microsoft is willing to take action only when correlation is strong enough that the false-positive risk is low. For everything else, Defender XDR remains a detect-and-alert system, and the human is in the loop.

When Attack Disruption fires in a customer's tenant, two things matter:

**Verify the action was correct.** A correctly disabled account is great. An incorrectly disabled account is a Tuesday-morning support call. You will need to re-enable the user, reset their credentials, and figure out what Defender saw — and decide whether you agree with it.

**Walk back the attack timeline.** Attack Disruption stops the spread, but the attacker was *in* before the system acted. The forensics work *after* a disruption event is exactly the same as forensics after any compromise. Don't let "Defender handled it" stop the investigation.

## Common surprises

A few things that catch new operators off guard.

**The portal renames itself.** Microsoft 365 Defender, Microsoft Defender XDR, Microsoft Sentinel + Defender, and now "Microsoft Security" all refer to overlapping but distinct things at different points in time. If a Microsoft Learn article from 2023 refers to a different portal name than what you see in 2026, you're not lost — you're just reading old documentation.

**Defender XDR is not Sentinel, but Microsoft is convincing them to merge.** Sentinel is Microsoft's SIEM. Defender XDR is Microsoft's XDR. They share data, they share UI surfaces (the unified Microsoft Defender portal can show both), but they're billed separately and configured separately. Many MSPs use only Defender XDR (covered by M365 licensing) and never deploy Sentinel (separately licensed, consumption-billed). That's a defensible choice for an SMB-focused MSP. Larger enterprises typically need both.

**E5 changes Defender's behaviour significantly.** Many of Defender XDR's deeper capabilities — Attack Disruption is the loudest example, but Threat Explorer, advanced-hunting retention, Custom Detection Rules at scale all qualify — work fully only at the E5 tier. Business Premium customers get a meaningful but reduced subset. Lesson 5 covers what is behind which paywall.

**The "Action Center" is where automatic remediations live.** When Attack Disruption disables a user, when AIR quarantines a file, when a Custom Detection Rule auto-resolves an alert — all of those go to the Action Center. If you only check Incidents and Alerts, you will miss what Defender already *did* on your behalf. Skim the Action Center weekly.

## What this means for the operator

Three takeaways.

**Defender XDR is configured, not watched.** Spend time on getting Attack Disruption enabled, AIR set to full-auto on Endpoint, alert grading consistent across tenants. Get the inbound alert routing right (email, PSA, Panoptica365). Then *resist the urge* to keep the portal open. It is not a dashboard; it is a forensics surface.

**Trust but verify Attack Disruption.** When it fires, it is usually right. The cost of acting wrong is a re-enable. The cost of *not* acting on a real AiTM compromise is a tenant-wide incident. The trade-off favours acting, but it has to be paired with an "every disruption event gets a human eyeball within 24 hours" practice. Quietly closed disruption incidents that nobody reads are how things get missed.

**Don't try to be Sentinel with Defender XDR.** If a customer needs custom correlation across non-Microsoft data sources — firewall logs, third-party SaaS logs, on-prem application telemetry — Defender XDR alone is not the right tool. Sentinel is. Pushing Defender XDR to do what Sentinel does will produce alert fatigue and silent gaps.

## What's next

- **Lesson 5: Microsoft 365 licensing.** The single biggest gating factor on what Defender XDR can actually do is licence tier. Lesson 5 walks through what each SKU unlocks.
- **Lesson 6: Where Panoptica365 sits in this picture.** Hint: we're *complementary* to Defender XDR, not a replacement. Defender XDR is the forensic system; Panoptica365 is the daily operating system.

Then we move on to card 2 (*Identity Threats & Attack Patterns*), which will have you opening Defender XDR for one specific user at a time — doing exactly the kind of drill-down it's good at.

For now: Defender XDR is the correlation layer that should mostly run itself. Your job is to set it up correctly, check on it weekly, and trust the automation to handle the rest.

---

*Sources for the data points in this lesson — Microsoft Learn on Defender XDR architecture and incident model ([Microsoft Learn — What is Microsoft Defender XDR?](https://learn.microsoft.com/en-us/defender-xdr/microsoft-365-defender)); Attack Disruption capability scope and supported attack types ([Microsoft Learn — Automatic attack disruption](https://learn.microsoft.com/en-us/defender-xdr/automatic-attack-disruption)); EDR/XDR/SIEM positioning context ([Microsoft Learn — Defender for Endpoint plans](https://learn.microsoft.com/en-us/defender-endpoint/microsoft-defender-endpoint)); Action Center reference ([Microsoft Learn — Action center](https://learn.microsoft.com/en-us/defender-xdr/m365d-action-center)).*
