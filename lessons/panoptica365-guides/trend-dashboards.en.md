---
title: "Trend dashboards — security over time"
subtitle: "The two longitudinal surfaces: a tenant's Trends tab and the fleet-wide Trends page, chart by chart."
icon: "trending-up"
last_updated: 2026-06-18
---

# Trend dashboards — security over time

The Main Console and a tenant's Overview answer *"how are things right now?"*. Trend dashboards answer the harder question: *"are we getting better or worse, and how do I prove it?"* There are two of them — a **Trends tab on each tenant dashboard**, and a **fleet-wide Trends page** in the sidebar. Both read from history Panoptica365 has been accumulating from its daily polls, so they cost nothing to open and add no load to Microsoft. Both carry a **range selector** — 7 d / 30 d / 90 d / 1 y — in the top-right.

A freshly-onboarded tenant won't have much of a line yet. Where history is still building, the chart says so (*"Trend begins …"*) rather than drawing a misleading flat line. Give it a few weeks.

## The tenant Trends tab

Open any tenant, then click **Trends** (the second tab, next to Overview). It's split into two halves — *what the customer sees* and *what the MSP sees* — with a coverage stat strip across the top.

**Coverage strip** — a one-line reassurance: how many of Microsoft's recommended controls are set up and healthy for this tenant. This is posture as a number, not a chart, because a well-run tenant sits at 100% and a flat line tells you nothing.

What the customer sees:

- **Microsoft Secure Score** (the hero chart) — Microsoft's canonical security measure for this tenant over time, with a dashed line showing the average for **similar-size businesses** (Microsoft's own benchmark). The score moves as Microsoft raises the bar; keeping the solid line above the dashed one is the job. The pill shows how many points you're ahead of, or behind, comparable tenants.
- **Secure Score by category** — the same score broken into Microsoft's categories (Identity, Data, Device, Apps, Infrastructure) as a stacked area. It shows *where* the points come from and *where the gaps remain* — the thinnest band is your next campaign.
- **Security recommendations addressed** — how many of Microsoft's recommended actions are actually in place, over time. This is the work that never finishes: Microsoft keeps adding recommendations, so a flat line here means you're keeping pace and a rising one means you're gaining ground.
- **Issues caught & resolved** — drift and threats Panoptica caught and your team cleared, by month and severity. This is the value story: proof the service is doing something.
- **Open issues over time** — how many items were awaiting action each day. Trending toward zero is the goal; a rising line means the backlog is growing faster than the team clears it.

What the MSP sees:

- **Time to resolve** — median hours from an alert firing to its resolution. Your responsiveness, in evidence — useful for SLA conversations.
- **Alert volume per week** — new alerts per week, by severity. Is this tenant getting noisier or quieter?
- **Top firing policies** — which policies generate the volume over the last 90 days, as a ranked bar. The longest bars are your tuning candidates: a policy that fires constantly is either a real problem or a policy that needs adjusting.

## The fleet Trends page

Click **Trends** in the left sidebar (just after Heatmap). This is the same idea, lifted to the whole book at once. It covers your **managed tenants only** — audit-only tenants aren't part of the fleet posture story — and is organized into *Secure Score & posture* and *Alert operations*, again with a coverage strip on top.

**Fleet coverage strip** — how many managed tenants are sitting at 100% of recommended controls, and the fleet-average coverage. The "north star" for the whole book.

Secure Score & posture:

- **Fleet Microsoft Secure Score** (the hero) — the average Secure Score across managed tenants over time. Three things ride on top of the average line: a shaded **high–low band** showing your best and worst tenant on each day (real numbers, not smoothed — you can verify them by hand), a dashed **similar-size benchmark**, and — only when you onboarded tenants during the window — a green **"existing tenants" line** that holds the same cohort constant. The tooltip tells you how many tenants the average was taken across that day.
- **Book growth — managed tenants** — how many managed tenants existed each day, with a marker on onboarding days. This chart is the explainer for the one above it: when you add a tenant that starts low, the fleet average dips — that's the book changing, not your existing customers getting worse. The green line on the hero and this chart together let you tell those two stories apart.
- **Recommendations outstanding** — total Microsoft recommended actions still open across the entire book. Are you collectively keeping up?
- **Secure Score by category** — the fleet-average score by Microsoft category over time. Wherever the *whole book* is weakest is the highest-leverage place to run a campaign across every customer at once.

Alert operations:

- **Issues caught & resolved** — fleet total resolved, by month and severity. How much did the team clear across everyone?
- **Open issues over time** — fleet total items awaiting action each day. Is the team keeping up across the book?
- **Time to resolve** — fleet median hours per week, with a **p90 line** above it. The median is the typical case; p90 catches the tail — a few slow-to-clear tenants that the median hides. SLA evidence for the whole fleet.
- **Alert volume per week** — fleet new alerts per week, by severity. Is it getting noisier overall?
- **Alert mix by category over time** — fleet new alerts grouped by policy category (risky sign-ins, threat management, external sharing, configuration changes, permissions, information governance) per week. It tells you *what kind of work* the book generates, which is what staffing and training should follow.
- **Top firing policies — last 90 days** — the noisiest policies across everything, ranked. These are your fleet-level tuning targets — adjust one policy and you quiet it for every customer.

## Reading them well

- **Secure Score moves because Microsoft moves the bar.** A dip doesn't always mean something got worse on your side — Microsoft may have added a recommendation. The benchmark line is the context that keeps you honest about that.
- **On the fleet hero, watch the band, not just the average.** A healthy average hiding a very low minimum means one customer is dragging — the band surfaces that; the average buries it.
- **Use the right range for the question.** 7 d / 30 d for an incident retrospective or a noisy week; 90 d / 1 y for a QBR or a board slide. The story changes with the lens.
- **Top firing policies are an invitation, not a verdict.** The longest bar is either a real recurring problem at that customer or a policy that's too sensitive. Both are worth acting on — one with the tenant, one with the policy.

*The dashboards tell you the state. The trends tell you the trajectory — and the trajectory is what a customer renewal, an SLA review, or a quarterly business review is actually about.*
