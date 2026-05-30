---
title: "The five surfaces M365 secures"
subtitle: "Identity, endpoints, email, collaboration, and cloud apps — the five stops on every attacker's tour through M365."
icon: "layers"
last_updated: 2026-05-29
---

# The five surfaces M365 secures

In 2024, a small accounting firm got compromised. The attacker started by phishing a credential out of a junior associate. That gave them mailbox access. In the mailbox they found a thread mentioning "the engagement letter is in the client SharePoint." They navigated to SharePoint, found 18 months of tax returns for 30 clients, downloaded them via OneDrive sync, and quietly logged out.

Identity → email → collaboration → cloud apps. One credential. Four surfaces. The firm's MSP only had monitoring set up for one of them.

When we say M365 "is" five surfaces, this is what we mean. They're not independent containers. They're stops on an attacker's tour. A control on any one of them only matters if it's good enough to stop the tour where it starts.

This lesson is the map.

## What "surface" means here

A surface is a category of attack target — a thing the attacker wants, and a place M365 stores or routes it. M365 has roughly five.

We're not the only ones who organize the stack this way. Microsoft itself slices the Defender XDR portal into "Identities," "Endpoints," "Email & collaboration," "Cloud apps." The CIS Microsoft 365 Benchmark divides controls along similar lines. Inforcer, Octiga, and most vendors in this space group their products into similar buckets. It's not arbitrary; it's how the threat model breaks naturally.

Here they are.

## 1. Identity

**What it is:** Entra ID — accounts, groups, devices, applications, service principals, the directory itself.

**What attackers want from it:** Credentials, tokens, sessions, the ability to *be* somebody. Identity is the front door to every other surface. Compromise an identity and you don't need to break the email server or the SharePoint site; you just sign in as somebody who has access.

**What protects it inside M365:**

- **Entra ID** itself — the directory, MFA, authentication methods, password protection.
- **Conditional Access** — enforces *which* sign-ins are allowed based on context (device compliance, location, app, risk score).
- **Entra ID Protection** (in the P2 SKUs only) — risk-based scoring of users and sign-ins.
- **Microsoft Defender for Identity** — monitors on-premises Active Directory if you still have one, plus hybrid sync activity.

**Where Panoptica365 monitors it:** This is the heaviest surface for us. Sign-in monitoring, MFA enforcement checks, authentication-method drift, Conditional Access posture, foreign-IP and impossible-travel alerts, plus Defender XDR identity alerts flowing in through the Unified Audit Log (UAL) — Microsoft's tenant-wide event stream that records every administrative action and most user activity.

## 2. Endpoints

**What it is:** The physical devices — Windows laptops, Macs, iPhones, Androids — that users sign in from. Each device is a piece of the perimeter, in the sense lesson 1 explained: there is no perimeter anymore, only fobs and the things holding them.

**What attackers want from it:** Initial foothold. A device they control is a place to run malware, harvest cached tokens, capture keystrokes, and persist after the user resets their password. Endpoints are also where many M365 sessions actually *live* — Outlook, OneDrive sync, the Teams desktop client all hold tokens locally on disk.

**What protects it inside M365:**

- **Intune** — device management. Enrolls the device, configures it, applies policies, checks compliance (encryption on, OS version current, AV running, no jailbreak).
- **Defender for Endpoint** — EDR. Behavioural monitoring on the device itself; this is what catches malware, suspicious processes, ransomware-like behaviour.
- **Defender Antivirus** — the AV that ships with Windows. Increasingly cloud-augmented and underrated.
- **Attack Surface Reduction (ASR) rules** — pre-emptive controls that block known-bad behaviour patterns (Office macros launching processes, scripts in temp folders, that kind of thing).

**Where Panoptica365 monitors it:** Intune deployment drift, device compliance posture, EDR rollout coverage. We don't currently parse raw endpoint telemetry — that's Defender's job, and replicating it would be a fool's errand.

## 3. Email

**What it is:** Exchange Online. Mailboxes, mail flow, calendar, contacts. The single highest-volume channel in any company.

**What attackers want from it:** Two things. First, *as a target* — financial fraud (invoice manipulation, wire-transfer redirection, business email compromise). Second, *as a vehicle* — phishing email sent onward to other users, including users at other companies the victim does business with. Compromised mailboxes are how *trusted-sender* phishing happens, which is the kind that actually works.

**What protects it inside M365:**

- **Exchange Online Protection (EOP)** — the baseline filter on mail flow. Anti-spam, anti-malware, mail flow rules.
- **Defender for Office 365** Plans 1 and 2 — anti-phishing policies, Safe Links (URL rewriting and time-of-click checks), Safe Attachments (detonation chamber), impersonation protection. Plan 1 is now bundled into Business Premium and E3 as of 2026; Plan 2 adds Threat Explorer, Attack Simulation Training, and Automated Investigation and Response.
- **Mailbox auditing** — tracks who did what inside a mailbox (rule changes, item deletions, forwarding configuration).
- **Inbox rule and mailbox-forwarding monitoring** — for spotting the silent auto-forward-to-Gmail rule attackers love.

**Where Panoptica365 monitors it:** anti-phish preset, mailbox audit posture, inbox-rule and mailbox-level forwarding detection, Safe Links and Safe Attachments configuration. This is the deepest single category in our monitoring catalogue.

## 4. Collaboration

**What it is:** SharePoint Online, OneDrive, Teams. The places files actually live and where teamwork happens.

**What attackers want from it:** The files. Tax returns. Engagement letters. HR records. Source code. M&A documents. Once they're in, this is where the *interesting* data is. They also want lateral movement — an over-permissive SharePoint site with external sharing turned on lets an attacker invite themselves to it from a Gmail address. Most data exfiltration in M365 attacks ends here.

**What protects it inside M365:**

- **SharePoint and OneDrive sharing controls** — who can share what externally, anonymous-link policies, link expiration, guest expiration.
- **Sensitivity labels** — automatic and manual classification of documents (Confidential, Highly Confidential, etc.) with attached encryption and access controls.
- **Data Loss Prevention (DLP)** — policies that detect sensitive data (SSNs, credit-card numbers, custom patterns) and block sharing.
- **Teams policies** — who can create teams, which apps are allowed, guest access.
- **Conditional Access for SharePoint and OneDrive** — applies the same compliant-device and trusted-location rules to file access.

**Where Panoptica365 monitors it:** SharePoint sharing posture, site permission inventory, external-sharing audit (the SharePoint audit module). Sensitivity-label coverage and DLP visibility are partial today.

## 5. Cloud apps

**What it is:** Every SaaS your user signs in to with their M365 identity that *isn't* M365. Salesforce, GitHub, Dropbox, the AI tool they signed up for on a Tuesday. Plus every OAuth-registered app and service principal sitting inside Entra ID itself.

**What attackers want from it:** Two things. First, persistent access through OAuth consent — an app they tricked the user into approving stays even after a password reset. Second, lateral data exfiltration — if your user has Salesforce access and an attacker compromises the M365 identity, they probably have Salesforce too. Federated SaaS is a force multiplier for compromise.

**What protects it inside M365:**

- **Entra ID app registrations and enterprise applications** — what's allowed to ask for permissions, what consent admins must approve.
- **OAuth consent policies** — restricting users from approving apps with high-privilege scopes.
- **Defender for Cloud Apps (MDA)** — SaaS-wide monitoring across registered apps; user-behaviour analytics; shadow-IT discovery.
- **Conditional Access for cloud apps** — the same rules can apply to non-Microsoft SaaS federated through Entra.

**Where Panoptica365 monitors it:** Lighter today than the other four surfaces. OAuth-grant inventory is partial. Defender for Cloud Apps alerts arrive through Defender XDR ingestion.

## The five surfaces aren't five products

The mistake junior operators make once they see this list is treating each surface as "the responsibility of one product." Identity is Entra. Endpoints are Intune. Email is Defender for Office 365. And so on.

That model is wrong, and it's wrong in a way that matters.

Look at the protection lists above and notice the overlap:

- **Conditional Access** appears under Identity, Collaboration, and Cloud Apps. It's a *cross-cutting* enforcement layer that operates wherever a sign-in happens.
- **Intune compliance** is an *endpoint* product, but its output (a compliance state per device) is consumed by Conditional Access on *every* sign-in to *every* surface.
- **Defender XDR** doesn't appear on any individual surface's list because it sits *above* all five — correlating signals across them and looking for incidents that span multiple.

The correct mental model is *layers*, not silos:

1. **Identity** is the layer every other surface depends on (signal: *who*).
2. **Endpoints** is the layer that produces the trust signal (signal: *from what*).
3. **Email** and **Collaboration** are the two main *data* layers (where the valuable stuff actually lives).
4. **Cloud apps** is the layer that extends those data layers out to non-Microsoft SaaS.

And **Conditional Access** is the *policy engine* operating across all of them. **Defender XDR** is the *detection and response engine* watching all of them.

If you only remember one shape from this lesson: the surfaces are *data and access targets*, the products are *enforcement and detection mechanisms*. They're orthogonal. A junior operator who thinks "Email = Defender for Office 365" will miss the half of email security that lives in Conditional Access, Entra ID Protection, and DLP. (Which is most of the interesting half.)

## What this means for the operator

Three concrete implications.

**You don't pick one surface to defend; you pick a chain.** Phishing → email → identity → cloud apps is one chain. Compromised laptop → endpoint malware → token theft → identity → SharePoint is another. Designing your monitoring around chains, not surfaces, is how you catch the attacks that traverse.

**Conditional Access is the single most leveraged control in this stack.** It's the only thing that operates across multiple surfaces at policy time. Misconfigure one CA policy and you can break access *or* leave a hole across three surfaces simultaneously. The good news: getting CA right is also the single highest-leverage thing you can do. We have a whole card on it (card 3).

**Detection-only is unfinished without correlation.** Watching email events alone is half a job. Watching sign-in events alone is half a job. The attack you care about — the chain — touches multiple. Defender XDR (lesson 4) and Panoptica365's alert correlation are both attempts at solving the same correlation problem from different angles.

## What's next

The rest of this card:

- **Lesson 3: Defender, Intune, Conditional Access — how they actually fit together.** The compliance-loop diagram and where each tool is configured. This is where "Conditional Access is the policy engine" gets concrete.
- **Lesson 4: Defender XDR — what it is, what it isn't.** The cross-surface correlation story.
- **Lesson 5: Microsoft 365 licensing — what unlocks what.** Because several of the controls above only exist at specific SKU tiers, and a Business Standard customer is missing half of them.
- **Lesson 6: Where Panoptica365 sits in this picture.** What we monitor, what we don't touch, why we don't auto-fix.

Then card 2 (*Identity Threats & Attack Patterns*) walks through real attack chains across these surfaces. By then, the chains should feel familiar — you'll be reading "credential → mailbox → SharePoint" and instinctively counting surface-traversals.

For now: the surfaces are stops on an attacker's tour. The products are enforcement and detection. Get the model right and the rest of the curriculum becomes shape, not memorization.

---

*Sources for the data points in this lesson — Microsoft 365 Defender portal organisation of identities, endpoints, email & collaboration, cloud apps as primary security domains ([Microsoft Learn — Defender XDR overview](https://learn.microsoft.com/en-us/defender-xdr/microsoft-365-defender)); Microsoft 365 Defender Threat Intelligence on cross-domain attack chains ([Microsoft Security Blog](https://www.microsoft.com/en-us/security/blog/), 2025); CIS Microsoft 365 Foundations Benchmark for the surface-based control taxonomy ([CIS](https://www.cisecurity.org/benchmark/microsoft_365)).*
