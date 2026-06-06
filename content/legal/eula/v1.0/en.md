# Panoptica365 — End User License Agreement

**Self-Hosted Software — Managed Service Provider License**
Version 1.0 · Effective Date: ____________, 20__

---

## Agreement and Acceptance

**This End User License Agreement (this "Agreement") is a binding legal agreement** between **Panoptica365 Inc.**, a corporation incorporated under the laws of [PROVINCE / JURISDICTION OF INCORPORATION] (the "Licensor"), and the entity or person that downloads, installs, accesses, or uses the Software (the "Licensee," "you," or "your"). Licensor and Licensee are each a "Party" and together the "Parties."

**BY INSTALLING, ACCESSING, OR USING THE SOFTWARE, OR BY CLICKING "I AGREE," YOU ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTOOD, AND AGREE TO BE BOUND BY THIS AGREEMENT.** If you do not agree, do not install, access, or use the Software. If you are entering into this Agreement on behalf of an organization, you represent that you have the authority to bind that organization, and "Licensee" refers to that organization.

The Software is licensed to managed service providers and IT professionals for use in a professional, business-to-business context. It is **not** a consumer product and is not intended for personal, family, or household use.

## 1. Definitions

**"Software"** means the Panoptica365 application in object/container form, including all modules, command-line components, scripts, configuration tooling, documentation, and any Updates that Licensor makes available, in each case as licensed to Licensee under this Agreement.

**"Documentation"** means the user, operator, and deployment documentation that Licensor provides or makes available for the Software.

**"Instance"** means a single deployment of the Software operated by Licensee within Licensee's own infrastructure or hosting environment.

**"Managed Tenant"** means a Microsoft 365 / Microsoft Entra tenant that Licensee monitors, configures, or otherwise administers using the Software, whether belonging to Licensee or to a customer of Licensee.

**"End Customer"** means a customer of Licensee whose Managed Tenant is administered through the Software.

**"Seat"** means a billable licensed user as defined in the applicable Order or Licensor's then-current published seat definition. Unless otherwise stated, a Seat is any enabled, member-type user account in a Managed Tenant that holds at least one paid Microsoft 365/Office 365 license, excluding guest/external accounts, disabled accounts, and shared, room, or equipment mailboxes.

**"License Key / License File"** means the credential or signed token issued by Licensor that authorizes a specified scope of use (including Seat count and term) for an Instance.

**"Order"** means an order form, quote, subscription, or other ordering document referencing this Agreement that sets out the licensed scope, Seat count, term, and fees.

**"Updates"** means patches, bug fixes, security fixes, new versions, and feature releases of the Software that Licensor makes generally available, whether delivered manually or through the Software's in-application update mechanism.

**"AI Features"** means features of the Software that use machine-learning or large-language-model services to generate analysis, summaries, triage, briefings, recommendations, or other output.

## 2. License Grant

Subject to Licensee's continuous compliance with this Agreement and payment of all applicable fees, Licensor grants Licensee a **non-exclusive, non-transferable, non-sublicensable, revocable, limited license**, for the term of the applicable Order, to install and operate one or more Instances of the Software within Licensee's own infrastructure and to use the Software to monitor and administer Managed Tenants, up to the licensed Seat count and solely for Licensee's internal business operations and the delivery of services to its End Customers.

All rights not expressly granted in this Agreement are reserved by Licensor. This Agreement grants a license to use the Software; it does **not** transfer any ownership of the Software or any intellectual property rights in it.

## 3. Licensing, Seats, and License Verification

### 3.1 Seats and scope

Licensee's use is limited to the Seat count and scope set out in the applicable Order. Licensee is responsible for keeping its Managed Tenants' user accounts accurate; accounts that remain enabled and licensed continue to count as Seats even where the underlying individual has departed the End Customer.

### 3.2 License verification and call-home

The Software periodically validates its License File and may transmit limited license-verification telemetry to a Licensor-operated service, including the Instance identifier/fingerprint, Software version, current Seat count, and license status. Licensee consents to this verification. Licensee acknowledges that this telemetry is necessary to operate the license and **agrees not to block, intercept, falsify, or circumvent it.**

### 3.3 Enforcement and offline tolerance

Where a license cannot be verified, has expired, or is exceeded, the Software may display warnings and, after a grace period, restrict certain functionality. Licensee acknowledges that the Software is designed to retain read access to previously collected historical data during such a restricted state, but that live monitoring, alerting, and configuration features may be unavailable until the license is restored. Licensor is not liable for any consequence arising from a restricted state caused by Licensee's non-payment, license breach, or interference with license verification.

## 4. License Restrictions

Except to the extent expressly permitted by this Agreement or by applicable law that cannot be contractually waived, Licensee shall not, and shall not permit any third party to:

- copy, distribute, resell, rent, lease, lend, host as a service to third parties outside the licensed scope, or otherwise make the Software available to anyone other than as permitted herein;
- reverse engineer, decompile, disassemble, or otherwise attempt to derive source code, underlying ideas, or algorithms of the Software;
- modify, adapt, translate, or create derivative works of the Software, except for permitted configuration;
- circumvent, disable, or tamper with any license, authentication, verification, telemetry, or security mechanism;
- remove, obscure, or alter any proprietary notices, branding, or attributions;
- exceed the licensed Seat count, or share, sublicense, or transfer a License Key except through a Licensor-approved reactivation process;
- use the Software to develop or assist a competing product, or to benchmark it for that purpose without Licensor's written consent; or
- use the Software in violation of any applicable law or any third party's terms of service.

## 5. Self-Hosting and Licensee Security Responsibilities

**The Software is self-hosted.** Licensee selects, provisions, and controls the environment in which the Software runs — whether on-premises, in a private data centre, or with a cloud provider such as Microsoft Azure, Amazon Web Services, OVHcloud, or any other infrastructure of Licensee's choosing. Licensor does not host, operate, or have access to Licensee's Instance.

**Licensee is solely and entirely responsible for securing its Instance and the environment in which it runs.** This responsibility includes, without limitation:

- securing network access to the Instance (firewalls, segmentation, VPN or zero-trust access, TLS, and restricting public exposure);
- hardening the host operating system, container runtime, and any database, and applying security patches to that underlying infrastructure;
- managing authentication and authorization to the Software, including the configuration of identity provider groups, role assignments, and administrative access;
- safeguarding all credentials, secrets, certificates, API keys, application registrations, and License Keys used by or with the Software;
- configuring, encrypting, testing, and retaining backups of the Instance and its data; and
- monitoring the Instance for unauthorized access and responding to any security incident affecting it.

Because the Instance, and the privileged access it holds to Managed Tenants, are under Licensee's exclusive control, **Licensor bears no responsibility or liability for the security of Licensee's deployment**, including any unauthorized access, data exposure, credential compromise, misconfiguration of the hosting environment, or breach arising from Licensee's failure to secure its Instance.

## 6. Acceptable Use and Operational Responsibility

The Software is a professional tool intended for use by competent IT and security administrators. **Licensee represents that it and its personnel possess the technical expertise required to operate the Software safely and to understand the effect of any configuration change before applying it.**

**Licensee is solely responsible for all actions it takes through, and all decisions it makes using, the Software, and for the consequences of those actions in its own and its End Customers' environments.** This includes, without limitation, the creation, modification, deployment, or removal of Conditional Access policies, Microsoft Intune device or compliance policies, Exchange Online or Teams settings, and any other security or configuration change.

By way of example and not limitation, Licensee is responsible if a configuration applied or influenced through the Software:

- locks users, administrators, or an entire organization out of a Managed Tenant (for example, an overly restrictive Conditional Access policy);
- blocks or disrupts business workflows, applications, or device functionality across an End Customer's fleet (for example, an Intune policy that prevents devices from operating as required); or
- causes data loss, downtime, service interruption, regulatory exposure, or other adverse impact in any Managed Tenant.

**Licensor is not responsible for Licensee's use or misuse of the Software,** for any configuration Licensee creates, deploys, or fails to deploy, or for any outcome of such configuration. Licensee is responsible for testing changes, validating them against each affected tenant, maintaining appropriate break-glass/emergency-access accounts and rollback procedures, and obtaining any necessary authorization from its End Customers before acting on their tenants. Any analysis, recommendation, score, or alert produced by the Software is informational only and does not relieve Licensee of the obligation to exercise independent professional judgment.

## 7. Third-Party Services and Dependencies

The Software interoperates with third-party platforms and services, including Microsoft 365, Microsoft Entra, Microsoft Graph, and Microsoft PowerShell endpoints, and may use third-party artificial-intelligence services to provide AI Features. Licensee's use of those third-party services is governed by the respective third party's terms, and Licensee is responsible for maintaining its own accounts, licenses, subscriptions, API keys, and consents with those providers.

Licensor does not control and is not responsible for third-party services, including their availability, accuracy, changes to their APIs or behaviour, rate limits, outages, pricing, or any costs Licensee incurs with them. Licensee is responsible for ensuring that its use of the Software with those services complies with the applicable third-party terms and with the licensing entitlements of each Managed Tenant.

## 8. Artificial Intelligence Features — Advisory Only

AI Features generate output using statistical models and **may produce results that are incomplete, inaccurate, outdated, or otherwise wrong.** All AI-generated analysis, triage, summaries, briefings, and recommendations are provided for informational and advisory purposes only. They are not professional, security, legal, or compliance advice, and must not be relied upon as the sole basis for any action.

Licensee is responsible for independently verifying AI output before acting on it. Licensor does not warrant the accuracy, completeness, or fitness of any AI-generated output and shall have no liability arising from Licensee's reliance on it. Licensee acknowledges that AI Features may transmit relevant context data to a third-party AI provider for processing and is responsible for ensuring such processing is permitted for the data involved.

## 9. Data, Privacy, and Telemetry

The Software runs within Licensee's environment and collects and stores data from Managed Tenants on infrastructure that Licensee controls. **Except for the license-verification telemetry described in Section 3 and any diagnostic data Licensee voluntarily provides for support, Licensor does not receive, store, or have access to Licensee's or its End Customers' tenant data.**

As between the Parties, Licensee is the party responsible for all personal and customer data processed through the Software and acts as the controller (or equivalent) with respect to that data. Licensee is responsible for complying with all laws applicable to its collection and processing of that data, including as applicable Canada's PIPEDA, Québec's Act respecting the protection of personal information in the private sector (Law 25), the EU/UK GDPR, and any contractual obligations to its End Customers, and for obtaining any necessary authorizations and consents. Licensee shall not send Licensor any End Customer personal data except the minimum reasonably necessary for support, and only where permitted to do so.

## 10. Intellectual Property

The Software, Documentation, and all related intellectual property are and remain the exclusive property of Licensor and its licensors, and are protected by copyright and other laws. The "Panoptica365" name, logo, and related branding are trademarks or trade dress of Licensor; Licensee acquires no rights in them except as expressly permitted. Licensee shall not remove or alter any proprietary notice. Any feedback or suggestions Licensee provides may be used by Licensor without restriction or obligation.

## 11. Updates, Upgrades, and Support

Licensor may make Updates available from time to time, including through the Software's in-application update mechanism, and may apply security-critical fixes. Licensee is responsible for reviewing and installing Updates within a reasonable period; Licensor is not responsible for issues arising from Licensee's operation of an outdated, modified, or unsupported version. Support, if any, is provided at the level and during the period set out in the applicable Order or a separate support agreement. Licensor may modify or discontinue features in future versions, provided that material reductions to a paid subscription's core functionality during its paid term will be addressed in good faith.

## 12. Disclaimer of Warranties

**TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SOFTWARE, DOCUMENTATION, AND ALL OUTPUT (INCLUDING AI FEATURES) ARE PROVIDED "AS IS" AND "AS AVAILABLE," WITH ALL FAULTS AND WITHOUT WARRANTY OF ANY KIND.** LICENSOR EXPRESSLY DISCLAIMS ALL WARRANTIES AND CONDITIONS, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, INCLUDING ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, QUALITY, AND NON-INFRINGEMENT. LICENSOR DOES NOT WARRANT THAT THE SOFTWARE WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE, THAT IT WILL DETECT OR PREVENT ANY PARTICULAR SECURITY ISSUE OR MISCONFIGURATION, OR THAT ANY OUTPUT WILL BE ACCURATE OR COMPLETE. THE SOFTWARE IS A MONITORING AND ADMINISTRATION AID AND IS NOT A SUBSTITUTE FOR LICENSEE'S OWN SECURITY CONTROLS, JUDGMENT, AND PROCEDURES.

Some jurisdictions do not allow the exclusion of certain warranties; to that extent the above exclusions may not apply, and any such warranty is limited to the minimum scope and shortest duration permitted by law. [CONFIRM CARVE-OUT LANGUAGE FOR GOVERNING JURISDICTION.]

## 13. Limitation of Liability

**TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, LICENSOR SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES,** or for any loss of profits, revenue, data, goodwill, or business, or for business interruption, service downtime, lockout, or the cost of substitute services, arising out of or relating to this Agreement or the Software, even if advised of the possibility of such damages and regardless of the theory of liability.

**LICENSOR'S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THIS AGREEMENT SHALL NOT EXCEED THE AMOUNTS ACTUALLY PAID BY LICENSEE TO LICENSOR FOR THE SOFTWARE DURING THE TWELVE (12) MONTHS** immediately preceding the event giving rise to the claim. [CONFIRM CAP — 12-MONTH FEES vs. FIXED AMOUNT.]

Without limiting the foregoing, Licensor shall have no liability for any loss or damage arising from (a) Licensee's configuration, deployment, or operational decisions, including any Conditional Access, Intune, or other policy change; (b) the security of Licensee's self-hosted environment; (c) reliance on AI or other Software output; or (d) third-party services. The limitations in this Section reflect an allocation of risk between the Parties and apply notwithstanding the failure of any limited remedy.

Nothing in this Agreement excludes or limits liability that cannot be excluded or limited under applicable law, including, where applicable, liability for gross or intentional fault, fraud, or bodily or moral injury. [CONFIRM MANDATORY CARVE-OUTS FOR GOVERNING JURISDICTION — e.g. arts. 1474 C.C.Q.]

## 14. Indemnification

Licensee shall defend, indemnify, and hold harmless Licensor and its officers, directors, employees, and agents from and against any third-party claims, damages, losses, liabilities, costs, and expenses (including reasonable legal fees) arising out of or relating to (a) Licensee's use or misuse of the Software; (b) any configuration, policy, or change Licensee creates, deploys, or fails to deploy in any Managed Tenant; (c) Licensee's failure to secure its Instance or environment; (d) Licensee's violation of this Agreement, applicable law, or any third party's rights or terms; or (e) any dispute between Licensee and an End Customer.

## 15. Term and Termination

This Agreement applies for as long as Licensee installs, accesses, or uses the Software, and continues for the term set out in the applicable Order. Either Party may terminate for the other's material breach not cured within thirty (30) days of written notice. Licensor may suspend or terminate the license immediately for non-payment, breach of Sections 4, 5, or 6, or interference with license verification.

Upon termination or expiry, all licenses end and Licensee shall cease using the Software, deactivate its Instances, and, at Licensor's request, delete or destroy the Software and License Keys. Licensee remains responsible for exporting or retaining its own data before termination. Sections that by their nature should survive — including Sections 4, 6, 8, 9, 10, 12, 13, 14, 16, 17, and 18 — survive termination.

## 16. Confidentiality

Each Party may receive confidential information of the other, including the non-public components, pricing, and License Keys of the Software. The receiving Party shall use such information only to exercise its rights and perform its obligations under this Agreement and shall protect it with at least reasonable care. This obligation does not apply to information that is or becomes public through no fault of the receiving Party, is independently developed, or is required to be disclosed by law (with notice where lawful).

## 17. Governing Law and Dispute Resolution

This Agreement is governed by the laws of the **Province of Québec and the federal laws of Canada applicable therein**, without regard to conflict-of-laws rules, and the Parties submit to the exclusive jurisdiction of the courts of the judicial district of [DISTRICT], Québec. The United Nations Convention on Contracts for the International Sale of Goods does not apply. [CONFIRM GOVERNING LAW, FORUM, AND WHETHER ARBITRATION IS PREFERRED.]

## 18. General Provisions

### 18.1 Entire agreement

This Agreement, together with any applicable Order, is the entire agreement between the Parties regarding the Software and supersedes all prior or contemporaneous understandings. In the event of conflict, an executed Order controls over this Agreement for the subject it addresses.

### 18.2 Amendments

Licensor may update this Agreement for future versions or renewal terms; the version accepted on installation or renewal governs that license. Material changes will be communicated through the Software or by notice.

### 18.3 Assignment

Licensee may not assign this Agreement without Licensor's prior written consent, except to a successor of all or substantially all of its business that agrees to be bound. Licensor may assign freely. This Agreement binds permitted successors and assigns.

### 18.4 Severability and waiver

If any provision is held unenforceable, it will be modified to the minimum extent necessary, or severed, and the remainder will remain in effect. No waiver is effective unless in writing, and no failure to enforce is a waiver.

### 18.5 Force majeure

Neither Party is liable for delay or failure (other than payment obligations) caused by events beyond its reasonable control.

### 18.6 Notices

Notices to Licensor must be sent in writing to [LICENSOR NOTICE ADDRESS / EMAIL]. Notices to Licensee may be sent to the contact or administrative email associated with its license.

### 18.7 Export and compliance

Licensee shall comply with all applicable export-control, sanctions, and anti-corruption laws in its use of the Software.

### 18.8 Language

The Parties confirm their wish that this Agreement and related documents be drawn up in English. / Les parties confirment leur volonté que la présente convention et les documents qui s'y rattachent soient rédigés en anglais. [CONFIRM — required-language considerations apply in Québec.]

## Acknowledgement and Acceptance

By installing, accessing, or using the Software, or by clicking "I Agree," Licensee acknowledges that it has read and understood this Agreement and agrees to be bound by it.
