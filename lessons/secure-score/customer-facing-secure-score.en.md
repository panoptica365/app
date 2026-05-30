---
title: "Customer-facing Secure Score — the deliverable, the trend, the renewal narrative"
subtitle: "How to turn Secure Score into a customer-facing deliverable that anchors renewal conversations and makes the MSP's security work visible."
icon: "presentation"
last_updated: 2026-05-29
---

# Customer-facing Secure Score — the deliverable, the trend, the renewal narrative

A renewal meeting. The MSP's account manager opens the laptop, navigates to Panoptica365's customer dashboard for the customer they're meeting, and shows the Secure Score tile: **84.1%** today, up from **47%** when the relationship started fourteen months ago. The "Similar size avg" comparison underneath reads 46%. The customer's CFO looks at the screen for a few seconds.

"So we went from below average to almost double the average."

"Yes. We've worked our way through Microsoft's recommended baseline. Most customers your size haven't done this work; you have."

"And this is what we've been paying for."

"This and the unscored work, yeah. The score is the part that's easy to see."

The renewal closes in under an hour. The customer signs for another two years and asks if the MSP can take on their sister company.

This is the most-valuable conversation in the curriculum, and Microsoft Secure Score is the artefact that makes it possible. Not because the number is the whole story — lessons 1 and 4 made clear that it isn't — but because customers respond to measurable improvement, and a 47%-to-84% trend is measurable. The number does what no amount of MSP self-description ever does: it externalises the work, third-party-authored, into something the customer's CFO can put on a slide for the board.

This lesson is about how to use Secure Score in customer conversations — what to show, when to show it, how to frame it, and where in Panoptica365 the surfaces actually live.

## The trend, not the snapshot

Operators new to the Secure Score conversation often lead with the current percentage: "you're at 84%." That's the wrong frame. The current percentage by itself answers no question the customer is actually asking. *Is that good? Compared to what? Is it normal? What's it doing?*

The right frame is the trend over time. "Your Secure Score has moved from 47% at onboarding to 84% today, an improvement of 37 percentage points over fourteen months. The industry average for similar-size organisations is around 46%. You're now in the top quartile of M365 tenants by configuration posture."

The trend tells a story. The snapshot is a statistic. Customers — especially the business stakeholders who don't operate the tenant day-to-day — respond to stories.

This applies even when the current score is low:

- **A customer at 41% with no trend yet** is the onboarding conversation. "This is our starting point. Here's the plan to move it. We expect to be at 70% by the next quarter and 80%+ within nine months."
- **A customer at 65% trending up** is the mid-relationship conversation. "Here's what we've done; here's what's next; here's the expected trajectory."
- **A customer at 88% trending flat** is the steady-state conversation. "We're at the configuration ceiling for what makes sense at your tier. The work now is maintenance — drift response, exception management, vendor email-hygiene awareness, the unscored items we covered last quarter."
- **A customer at 88% trending *down*** is the diagnostic conversation. "Something has drifted. Let's look at what's moved." (Often the MDVM vulnerability detection cause from lesson 2.)

Every conversation has a frame based on the trend. The current number is one data point in that frame; never the whole conversation.

## The baseline at onboarding — captured automatically

When you onboard a new customer in Panoptica365, the first Secure Score poll happens automatically as soon as the tenant is connected. That first reading goes into the database. Every subsequent poll is stored alongside it, day after day, for as long as the relationship lasts. By the customer's first renewal twelve months later, the system already has roughly 365 daily readings behind the score on screen. The baseline isn't something the operator has to remember to capture — it's the first row of the history table.

This matters for two operator workflows:

**The renewal conversation has data behind it automatically.** Six months in, when the customer asks "are we actually safer now?", you have a verifiable answer because the data is in the database: "Your Secure Score was 39% the day we onboarded; it's 71% today." You assemble the trajectory from milestone notes and your record of work done; the underlying numbers are queryable from Panoptica365's stored history when you need to verify them.

**Customer expectations get anchored over time.** Customers sometimes forget how unconfigured their tenant was at onboarding. By month 12 they've come to expect MFA, Safe Links, mailbox auditing, and CA policies as baseline. The 39%-to-71% movement reminds them this wasn't always the case — *you did this for them*.

For the operator, the continuous capture means the *record* is always there even if the surfaced visualisation isn't (yet) — the database holds the history; what the dashboard surfaces is the current tile. Operators piece the trend together from documentation and operator notes for now.

## Where Panoptica365 shows the score

Panoptica365's Secure Score surface is one of the platform's more developed views. Three places to know:

**The main console dashboard — the cross-tenant view.** When you sign in to Panoptica365, the main dashboard includes a **Tenants panel** listing every customer tenant with their current Secure Score in a colour-coded column (green for high scores, red for low). The panel has a filter box so you can search by tenant name across a large book. The Status column shows polling state; the Last Polled column shows when the score was last refreshed from Microsoft. Below the Tenants panel sits a **Secure Score & Alert Overview** showing three donut graphs side by side: the **Average** Secure Score across all your managed tenants, the **Highest** tenant (with the tenant name displayed), and the **Lowest** tenant (with the name). This three-donut overview is the genuine cross-tenant aggregation view that doesn't exist anywhere in Microsoft's portals — it's a meaningful Panoptica365 differentiator.

**The per-tenant Secure Score tile.** When you click into a specific customer's dashboard, the Secure Score tile is among the first things you see. The tile shows the headline percentage in large type (e.g., **88.79%**), the raw points / max underneath (`988.2 / 1113.0`), and the **Similar size avg** comparison Microsoft publishes (e.g., `Similar size avg: 46.74%`). The tile is colour-coded — green for healthy scores, transitioning to amber and red as the score drops.

**Stored score history — not yet surfaced as a chart.** Panoptica365 polls the Secure Score continuously and stores every reading in the database. The historical data is there from day one of the customer relationship. What the dashboard does *not* currently include is a surfaced trend visualisation — there's no chart in Panoptica365's UI that an operator can open to see "this customer's score over the last twelve months." For now, the trend story is assembled manually: from operator notes captured at meaningful milestones (deployments, quarterly reviews), from screenshots saved at key moments, and from operator memory of the work done.

What Panoptica365 does *not* surface in the dashboard: a recommendation-by-recommendation drill-down (that's in the Microsoft Defender portal, lesson 1 covered this), a per-recommendation action button to apply the fix (Microsoft owns the action surface), a generated PDF report for customers (those are exported manually or built from the tile's data), and the trend chart described above.

## The renewal conversation — using the surfaces

A pattern that works well for an annual review or contract renewal:

1. **Open Panoptica365's main dashboard** with the customer's tenant filtered or scrolled into view. Show the Tenants panel briefly — the customer sees their score in context of your other customers (without naming the others), which signals "we have a book of similar customers and we benchmark against them."

2. **Click into the customer's tenant.** The Secure Score tile is right there. Read the three numbers aloud: the percentage, the points / max, the similar-size-avg comparison. "You're at 88.79%; the average for similar-size companies is 46.74%; you're roughly double the average."

3. **Walk the trend.** From your customer documentation — the milestone notes, the screenshots taken at deployment points, your record of what was done when — narrate the trajectory. "Your baseline at onboarding was 47%. We hit 62% after deploying the CA templates in March. We hit 74% after the Intune deployment in May. We're at 84% today." Each movement ties to specific work the customer paid for and that you delivered.

4. **Acknowledge the unscored work.** "And here's what the number doesn't show — DMARC enforcement is now at p=reject, your mail flow rules have been audited and cleaned up, your exception ledger has 14 documented decisions reviewed in the last quarter. Microsoft doesn't score any of this, but it's where most of the actual security value lives."

5. **Set the next-quarter target.** "Our goal for the next 12 months is to keep the score in the high 80s while we work the unscored discipline. We're at the ceiling of what makes sense for Business Premium without crossing into E5 features that don't pay for themselves at your size."

The conversation lasts 15-20 minutes. It's anchored on visible numbers and tied to specific work. By the end, the customer understands what they're paying for in a way they didn't before they sat down.

## How to talk about a low score

Low scores happen — newly onboarded customers, customers who joined under previous mismanagement, customers who didn't have an MSP at all. The conversation needs to thread between "this is bad and we have to act" (urgency) and "this isn't your fault and we're not blaming you" (relationship preservation).

A workable structure:

- **Lead with the trajectory, not the indictment.** "Your starting point is a 41% Secure Score. Most customers we onboard start somewhere between 35 and 55%; you're in the middle of that range. We have a clear path to move this number." Not: "Your previous provider missed a lot."
- **Identify the half-dozen** (lesson 3) as the visible improvement plan. Walk through which items will be implemented and the expected score impact of each.
- **Set realistic timeline expectations.** Going from 41% to 80%+ is typically a six-to-nine-month journey for the operator team. Don't promise faster; faster usually means cutting corners on customer-specific tuning.
- **Show the unscored work that runs in parallel.** "While we're moving the score, we're also doing the DMARC enforcement work, the mail flow rule audit, the exception documentation. These don't show up in the number but they're a meaningful part of the security improvement."

A 41% customer who sees a 47% reading three weeks later, an 58% reading at three months, and a 78% reading at nine months stays a customer. A 41% customer who's been told "we'll get you to 100% next month" and ends up at 62% feels lied to.

## How to talk about a high score

The opposite problem: customers seeing a 92% number sometimes conclude they're done. They've won. They're "secure." The MSP's job at that point is to gently re-anchor.

A workable framing:

- **Acknowledge the score honestly.** "Your Secure Score is in the top decile of M365 tenants. The Microsoft-recommended baseline is implemented end-to-end for your tier."
- **Remind them of the limits.** Reference lesson 4's framing. "The score measures configuration. It doesn't measure whether your vendors have good email hygiene, whether your users would recognise a sophisticated phishing attack, whether our incident response would catch a compromise within the window that matters. Most of the actual security work between now and next year is in those areas — not in the number."
- **Use the renewal to redirect to discipline.** "We're not going to focus on moving the score from 92% to 95% — that would mean either gaming the metric or implementing recommendations that don't fit your business. We're going to focus on the unscored work: drift response, vendor awareness, user training, exception ledger review. That's what keeps the 92% from being false comfort."

The conversation prevents the customer from disengaging because they think the security work is done. It's never done; the score just doesn't tell you that.

## What this means for the operator

Three takeaways.

**The trend is the customer conversation; the snapshot is just the data point.** Lead with the trajectory. The 47%-to-84% movement is the story; the 84% today is the line on the chart. Customers remember stories.

**The day-one baseline is captured automatically — make sure your customer documentation references it.** Panoptica365 records the first Secure Score poll the moment a tenant connects, and every poll thereafter. The data is in the database; what the dashboard surfaces today is the current tile. Operators piece the trend together from their own records — milestone notes, screenshots saved at deployments, the documentation captured at each major step. Day-one is the most-cited number you'll reference about a customer; the discipline is keeping the milestone record alongside the automatic capture.

**Use Panoptica365's cross-tenant view as the genuine differentiator.** The Tenants panel + three-donut overview shows the customer (when appropriate) that you operate a real book of similar customers. Microsoft's portal can't do this. The customer's CFO who sees "average across our managed customers is 85.8%" and "you're at 88.79%" gets two messages at once: you have peers, and you're ahead of them.

## What's next

- **Lesson 6: Operating Secure Score at scale + closing the curriculum.** The quarterly review cadence, the 80%+ target framing, what to do when scores trend in concerning directions across the book, and the closing argument for what good MSP security looks like.

For now: pick the customer whose annual review is coming up. Open Panoptica365's main dashboard. Take a screenshot of their score tile and the cross-tenant context. Pull together the trend from their history. Walk into the renewal meeting with a story, not a statistic. The 47%-to-84% story is the story you want to tell — and the customer to hear.

---

*Sources for the data points in this lesson — Microsoft Learn on Secure Score history and trend tracking ([Microsoft Learn — Track Secure Score history](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-history-metrics-trends)); Secure Score industry comparisons and similar-size organisation averaging ([Microsoft Learn — Secure Score comparisons](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions)); Secure Score overview and tile data structure ([Microsoft Learn — Microsoft Secure Score](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score)); Secure Score API for programmatic access to the data Panoptica365 surfaces ([Microsoft Learn — Secure Score API in Graph](https://learn.microsoft.com/en-us/graph/api/resources/securescore)).*
