---
title: "ASR Rules + Block mshta.exe — attack surface reduction"
subtitle: "19 ASR rules all in Block mode plus a mshta.exe firewall rule — blocking the behavioural chains malware uses before signatures can detect them."
icon: "bug"
last_updated: 2026-05-29
---

# ASR Rules + Block mshta.exe — attack surface reduction

A common pattern in malware delivery: a user opens a Word document attached to a phishing email. The document contains a macro. The macro spawns a PowerShell process. The PowerShell process downloads an executable from a remote server. The executable runs, establishes persistence, and the attacker has a foothold on the device.

Every step in that chain is *legitimate Windows functionality*. Word can have macros. Macros can call PowerShell. PowerShell can download files. Files can execute. Each step, taken in isolation, is something a developer or a power user might legitimately do. But the *combination* — Word → macro → PowerShell → download → execute — is a behaviour pattern that almost never has a legitimate business reason and almost always indicates malware delivery.

Attack Surface Reduction (ASR) rules are Microsoft's mechanism for catching exactly these behavioural patterns. Rather than identifying specific malicious files, ASR rules block the *combinations* of legitimate-but-unusual actions that malicious code uses to chain into a successful compromise.

This lesson covers the Panoptica365 ASR Rules Standard template (the comprehensive ASR ruleset) and the related Block mshta.exe outbound connections template (a focused firewall rule that complements the ASR ruleset). Together they form the pre-emptive behaviour-based defence layer on Windows endpoints.

## The ASR Rules Standard template

The template configures **19 ASR rules — all in Block mode** — plus Controlled Folder Access (in a different mode; see below). It uses the Settings Catalog template type with `endpointSecurityAttackSurfaceReduction` as the family. The template's posture, in one line: pretty much block everything.

The 19 rules, grouped by what they catch:

### Office-based malware delivery (the most common attack chain)

- **Block all Office applications from creating child processes.** Word, Excel, PowerPoint, etc. shouldn't be spawning processes. When they do, it's almost always a macro launching something malicious.
- **Block Office applications from creating executable content.** Office apps writing .exe / .dll files to disk is highly suspicious.
- **Block Office applications from injecting code into other processes.** Code injection from Office into other processes is a classic malware technique.
- **Block Office communication app from creating child processes.** Outlook specifically — Outlook spawning processes is even more rare than other Office apps.
- **Block Win32 API calls from Office macros.** Macros that call into the Win32 API directly are doing something a normal business macro wouldn't.
- **Block JavaScript or VBScript from launching downloaded executable content.** Downloaded scripts launching downloaded executables is the heart of "drive-by" malware delivery.
- **Block execution of potentially obfuscated scripts.** Heavily obfuscated PowerShell or VBScript is a strong malware signal — legitimate scripts have no reason to obfuscate themselves.

### Document-reader-based delivery

- **Block Adobe Reader from creating child processes.** Adobe Reader is a parallel attack vector to Office — malicious PDFs sometimes embed scripts or invoke launchers that spawn child processes. Same defensive logic as the Office rules: a PDF reader has no business spawning other processes.

### Email-based delivery

- **Block executable content from email client and webmail.** Email attachments that are executables (or that download executables) shouldn't be running directly from the mail client.

### Credential theft

- **Block credential stealing from Windows Local Security Authority subsystem (LSASS).** This catches Mimikatz-style attacks where malware tries to dump credentials from LSASS memory. Highly diagnostic — a process accessing LSASS for credential extraction almost always indicates compromise. This rule in the Panoptica365 template ships with one per-rule exclusion: `wazuh-agent.exe`. Wazuh is an open-source SIEM/XDR agent that legitimately reads LSASS for credential monitoring; without the exclusion, the agent itself would be blocked by the very rule it depends on observing. Concrete example of how a per-rule exclusion works in practice: the rule still fires for everything else, but Wazuh gets a permanent free pass.

### Persistence, lateral movement, and defense evasion

- **Block persistence through WMI event subscription.** WMI event subscription is a stealthy persistence technique malware uses to survive reboots; legitimate apps almost never use it.
- **Block process creations from PsExec and WMI commands.** PsExec and WMI-based remote execution are common lateral movement tools.
- **Block rebooting machine in Safe Mode.** Some ransomware reboots into Safe Mode to disable security products before encrypting.
- **Block use of copied or impersonated system tools.** Malware sometimes copies legitimate system binaries (like cmd.exe) to other locations and runs them from there, evading some detection rules.

### USB and removable media

- **Block untrusted and unsigned processes that run from USB.** USB-delivered malware is a long-standing vector; this rule catches unsigned executables launching from removable drives.

### Server-specific

- **Block web shell creation for servers.** Specifically for Windows Server installs — catches malicious file uploads that drop web shells (PHP, ASPX) onto IIS or other web servers.

### Driver and exploitation defense

- **Block abuse of exploited vulnerable signed drivers.** Catches malware that uses known-vulnerable signed kernel drivers as a vector for privilege escalation. Microsoft maintains the list of vulnerable drivers.
- **Block executable files running unless they meet prevalence, age, or trusted list criterion.** A files-without-pedigree rule — executables that are too new, too rare, or not on a known-safe list get blocked. Catches novel malware variants; can false-positive on legitimate niche software.

### Ransomware-specific

- **Use advanced protection against ransomware.** A behavioural rule that catches encryption patterns characteristic of ransomware.

## Controlled Folder Access — the deliberate exception

Adjacent to the 19 ASR rules, the template also enables **Controlled Folder Access (CFA)** — but in **Audit Mode**, not Block. This is the one place where the template explicitly steps back from the "block everything" posture, and it's intentional.

CFA restricts which apps can write to protected folders (Documents, Pictures, Desktop, etc.). In Block mode, apps not on the allowlist get prevented from modifying files in those locations. In Audit Mode, those same writes are *logged* but not blocked — Defender records who tried to write what to a protected folder, but the write proceeds.

The reason for Audit Mode: too many legitimate applications write to protected folders on a normal Windows device. Backup tools writing to user documents, sync clients (Dropbox, Google Drive, OneDrive), creative apps writing project files to Documents, productivity tools auto-saving — the list is long. Running CFA in Block mode out of the gate generates an avalanche of help-desk tickets ("my OneDrive stopped syncing," "my backup is failing," "Photoshop won't save"). Audit Mode keeps the visibility (you can see what's being attempted) without breaking workflows.

Operators who want stronger ransomware protection can flip CFA to Block mode per customer after building an allowlist of legitimate apps for that environment. The template ships in Audit so the default deployment doesn't cause workflow breakage; the Block-mode upgrade is a per-customer hardening step, not a fleet-wide default.

## ASR rule modes — the crucial distinction

Every ASR rule can be set to one of four modes:

- **Audit** — the rule evaluates and logs matches, but doesn't block. Used for testing and discovery.
- **Block** — the rule evaluates and blocks matching behaviour. The production mode.
- **Warn** — the rule warns the user when matching behaviour occurs; the user can override and proceed. Available for some rules; intermediate between Audit and Block.
- **Not configured / Off** — the rule isn't active.

The Panoptica365 ASR Rules Standard template sets **all 19 ASR rules to Block** out of the gate. Controlled Folder Access is the only one in Audit (see the previous section). The template's authors picked rules specifically because they have low false-positive rates in 2026 — Microsoft has tuned them for years, and the chosen ruleset avoids the more historically problematic rules. The template's design intent is direct-to-Block deployment.

**The operational reality**: even with carefully-selected rules, deploying ASR rules to Block on a fleet that's never had them will occasionally catch legitimate-but-unusual business activity that the template's authors couldn't predict. Industry-specific software, niche tools, custom-built internal apps with weird Office macro patterns — these can still trigger rules and get blocked, breaking user workflows.

Two acceptable approaches, depending on the customer:

**Direct-to-Block (the template's default).** Deploy as the template ships — all rules in Block. Suitable for customers whose app inventory you know well, who run mainstream business software, who don't have legacy custom apps with weird Office or LOLBin patterns. Most SMB tenants fit this profile. Be ready to add per-rule exclusions as legitimate breakage surfaces.

**Audit-mode pre-flight (the cautious option).** For customers with unknown or unusual software inventory — industrial control vendors, custom-built line-of-business apps, healthcare-specific software, anything outside the mainstream SaaS world — flip each rule to Audit before deployment, monitor for 14–30 days, build the exclusion list, then flip to Block:

1. Modify the template per-customer to set each rule to Audit before deployment.
2. Run in Audit mode for 14–30 days. Pull audit logs every few days.
3. For each rule that fired against legitimate activity, add a per-rule exclusion for the affected process or file (the LSASS rule's Wazuh exclusion above is the model).
4. Once the audit period is clean, flip the rules back to Block.

The choice between direct-to-Block and Audit-pre-flight is per-customer. The template ships in direct-to-Block because that's the right answer for the majority of SMB tenants; operators who know a customer's environment is unusual should reach for the Audit pre-flight instead.

## The Block mshta.exe template — the focused complement

Adjacent to the ASR Rules template is a separate, focused template: **Panoptica365 - Block mshta.exe outbound connections.**

The template's description is unusually thorough: *"Blocking outbound connections from mshta.exe has minimal user impact but significantly reduces attack surface by preventing a commonly abused LOLBin from reaching external payloads and C2 servers."*

The acronym LOLBin stands for **Living Off the Land Binary** — a legitimate Windows binary that attackers abuse to do malicious things. mshta.exe is the classic example: it's a built-in Windows utility for executing HTML Application (.hta) files, and it's been part of Windows for decades. Almost no legitimate business workflow uses mshta.exe in 2026; almost every malware family that runs on Windows includes mshta.exe as one of its execution vectors because it's already on every Windows device, it's signed by Microsoft, and it can be invoked from many contexts (Office macros, scheduled tasks, command-line, scripts).

The template blocks **outbound network connections** specifically from mshta.exe. That is: mshta.exe can still run if a legitimate use case invokes it, but it can't reach external C2 infrastructure or download payloads from the internet. The malicious-use case becomes severely degraded.

The template uses the same `endpointSecurityFirewall` family as the main Firewall Settings template (lesson 6). It's technically a firewall rule rather than an ASR rule, but conceptually it's an attack-surface-reduction control — it removes a specific path that attackers rely on.

This is the right pattern for LOLBin defence: identify the legitimate-but-rarely-used Windows binaries that attackers love, and surgically restrict the specific behaviour that makes them useful for attack. The Panoptica365 library currently ships this template for mshta.exe specifically; similar templates could be built for other LOLBins (cscript.exe, wscript.exe, certutil.exe, regsvr32.exe, msbuild.exe, installutil.exe, rundll32.exe — there's a long list). For now, mshta.exe is the one that's bundled.

## What can break

ASR rules and the mshta.exe block can produce false positives. The most common categories:

**Custom internal apps that do things they shouldn't.** A custom-built business application that includes Office macros doing weird things, or that uses mshta.exe for some legacy reason, or that calls Win32 APIs from Excel for performance, will get blocked. The fix is per-app exclusions in the ASR rule configuration.

**Niche software vendors with poor coding practices.** Some commercial software (especially older, niche, or industry-specific) violates ASR rules as part of normal operation. The vendor's installer launches PowerShell, the vendor's main app injects code into other processes, etc. Fixes are vendor-specific exclusions.

**PsExec / WMI-based remote management tools.** Some legitimate remote management tools use PsExec or WMI-based remote execution, which gets caught by the corresponding ASR rule. If a customer's IT team uses these tools, they need exclusions.

**Custom PowerShell scripts that download and execute.** A legitimate internal automation that downloads a payload and executes it (e.g., an installer kicked off by a logon script) will trigger the JavaScript/VBScript-downloaded-executable rule. Exclusions or rewriting the automation.

**Anti-ransomware Controlled Folder Access.** With the template's default of CFA in Audit Mode, nothing breaks — the writes are logged but allowed. The "what would break if CFA were in Block mode" list is long though: backup software writing to user documents, sync clients (Dropbox, Google Drive, OneDrive — OneDrive is usually on Microsoft's default allowlist), creative tools writing to Documents, productivity apps auto-saving. This is exactly why the template deliberately ships CFA in Audit: blocking these out of the gate would generate a flood of help-desk tickets. Operators who later flip CFA to Block for a specific customer should build the allowlist from the Audit-mode logs first.

## Rollout

For mainstream SMB tenants (familiar app inventory, standard SaaS-heavy environment), the template's direct-to-Block default is the right deployment posture:

1. **Day 0** — deploy the template as it ships (all 19 ASR rules in Block, CFA in Audit). Pilot group first per lesson 1's pre-flight.
2. **Days 1–14** — monitor for help-desk tickets and Defender block events. False positives that need exclusions will surface as user-reported workflow breakage ("X stopped working after the update"). Triage each: false positive (add exclusion), true positive (investigate as a security incident), edge case (decide per case).
3. **Day 14+** — expand assignment from pilot group to full scope once the pilot devices are clean. Continue monitoring for the first 30 days and add exclusions as new ones surface.

For customers with unusual software inventory (industrial control, healthcare-specific, custom line-of-business apps with legacy patterns), use the Audit pre-flight from the previous section instead — flip each rule to Audit, run for 14–30 days, build exclusions, then flip to Block.

**Controlled Folder Access** ships in Audit by design. Operators wanting to enable it in Block mode (stronger ransomware protection) should do so per-customer after building an allowlist of legitimate apps writing to protected folders. This is a hardening upgrade, not part of the standard rollout.

**The Block mshta.exe template** can deploy directly without an Audit window — the failure surface is so narrow that almost no legitimate workflows use mshta.exe in 2026.

## What to monitor after enforcement

**ASR rule matches per rule per device.** Once in Block mode, matches should be rare. Spikes indicate either malware activity (real positives) or legitimate-but-undocumented activity that needs an exclusion.

**User-reported workflow breakage.** Track every "X stopped working" complaint. Triage by likely ASR cause; document each exclusion added.

**Controlled Folder Access audit events.** Even in Audit mode, CFA logs every protected-folder write attempt by a non-allowlisted app. This is useful intel — it shows you exactly which apps would have been blocked if CFA were in Block mode. If you ever decide to flip CFA to Block for a customer, the audit log is your pre-built allowlist source. Look for: backup tools, sync clients (Dropbox, Google Drive, OneDrive), creative apps, productivity tools auto-saving to Documents.

**mshta.exe outbound block events in the firewall log.** Should be very low volume in normal operation. Spikes are interesting — either a real malware attempt blocked successfully, or a legitimate-but-rare use case that needs an exclusion.

**Drift on either template.** Both templates are common targets for "an admin disabled this because [user complaint]." Drift detection flags these.

## The customer conversation

When proposing ASR rules to a customer, the honest pitch:

- These rules catch the specific behaviour patterns malware uses to chain together a successful compromise — Office-macro-to-PowerShell-to-download-to-execute, LSASS credential theft, USB-delivered payloads, ransomware encryption patterns.
- The template's defaults block aggressively; we expect this to fit most environments cleanly, with occasional per-app exclusions for legitimate-but-unusual workflows.
- If your environment has unusual line-of-business apps — anything custom-built, industry-specific, or with weird Office-macro patterns — we'll run a 14–30 day Audit-mode pre-flight before flipping to Block, so we find any legitimate workflows that would break before they actually break.
- Controlled Folder Access is enabled in Audit Mode (logging only). Stronger ransomware protection (CFA in Block) is a separate hardening upgrade we can apply once we've inventoried the apps that legitimately write to protected folders on your fleet.

For tenants in specific industries — healthcare, finance, government contracting — ASR Rules are often a regulatory expectation. For tenants without those drivers, ASR Rules are still strongly recommended; the value proposition is clearer if you can name specific attacks the customer has been concerned about.

## What this means for the operator

Three takeaways.

**The template ships aggressive — 19 ASR rules in Block, CFA in Audit — and is intended to deploy as-is on mainstream SMB tenants.** Reach for the Audit-pre-flight pattern when you don't know the customer's app inventory, when the customer runs unusual line-of-business software, or when previous deployments have flagged false-positive breakage. Don't reach for it as a default — the template's design intent is direct-to-Block.

**The Block mshta.exe template is the model for LOLBin defence.** Surgical, focused, narrow blast radius. As Microsoft adds more LOLBin coverage to its built-in defences, this kind of focused supplementary rule may become less necessary — but for now, mshta.exe specifically is a known attacker favourite and the block is well-targeted.

**Maintain exclusion lists per customer.** Every ASR exclusion is per-customer (because each customer has different business apps and different niche software). Panoptica365's exemption system can track these; they need ongoing maintenance as the customer's app inventory changes.

## What's next

- **Lesson 8: Account Protection + Block MSA.** Windows Hello for Business, Credential Guard, blocking personal Microsoft Account additions on managed devices.
- **Lesson 9: The compliance loop in production.** How all these templates surface as signals.

For now: ASR Rules + Block mshta.exe form the pre-emptive behaviour-based defence layer. Deploy as the template ships for mainstream tenants (direct-to-Block, CFA in Audit); use the Audit-mode pre-flight when the customer's environment is unusual. The discipline of knowing *which posture fits which customer* is what makes this template add value rather than friction.

---

*Sources for the data points in this lesson — Microsoft Learn on ASR rules ([Microsoft Learn — Attack surface reduction rules reference](https://learn.microsoft.com/en-us/defender-endpoint/attack-surface-reduction-rules-reference)); ASR rule deployment guidance ([Microsoft Learn — ASR rules deployment](https://learn.microsoft.com/en-us/defender-endpoint/attack-surface-reduction-rules-deployment)); Controlled Folder Access ([Microsoft Learn — Controlled Folder Access](https://learn.microsoft.com/en-us/defender-endpoint/controlled-folders)); LOLBin reference ([LOLBAS project](https://lolbas-project.github.io/)); mshta.exe attack vector context ([MITRE ATT&CK — Mshta](https://attack.mitre.org/techniques/T1218/005/)).*
