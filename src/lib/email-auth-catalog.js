/**
 * Panoptica365 — Email-auth provider + DKIM selector catalog (Feature A6)
 *
 * Seed data + pure detection helpers for the Email Auth tab's DKIM engine.
 * Sourced from `Documentation/Panoptica365 - DKIM Selector Catalog (research)
 * 2026-06-22.md` — cite that doc, not training data, when extending.
 *
 * The governing principle (RFC 6376): a domain's DKIM selectors are NOT
 * enumerable from DNS. We can only probe a catalog of known names, and a miss
 * never proves DKIM is absent. That is why the verdict is three-state
 * (pass / fail / indeterminate), and why provider DETECTION (MX + SPF) — not
 * the probe result alone — decides whether a miss is a fail.
 *
 * Provider keys are shared between detection maps and PROBEABLE_SELECTORS so a
 * detected provider can be cross-referenced to the selectors we *expected*.
 *
 * Pure + I/O-free → unit-testable in isolation.
 */

'use strict';

// ── Tier 1: providers with fixed, high-confidence selectors. A miss against a
//    DETECTED tier-1 provider is a finding (the headline M365 case). ──────────
const PROBEABLE_SELECTORS = {
  // M365 DKIM CNAME targets moved from <tenant>.onmicrosoft.com to the newer
  // *.dkim.mail.microsoft infra — accept both (and treat as advisory, not a gate).
  microsoft365: { selectors: ['selector1', 'selector2'], type: 'cname', target_contains: ['onmicrosoft.com', 'dkim.mail.microsoft'], label: 'Microsoft 365' },
  google:       { selectors: ['google'], type: 'txt', label: 'Google Workspace' },
  sendgrid:     { selectors: ['s1', 's2'], type: 'cname', target_contains: 'sendgrid.net', label: 'SendGrid' },
  mailchimp:    { selectors: ['k1', 'k2', 'k3'], type: 'cname', target_contains: 'mcsv.net', label: 'Mailchimp' },
  mandrill:     { selectors: ['mte1', 'mte2', 'mandrill'], type: 'cname', target_contains: 'mcsv.net', label: 'Mandrill' },
  hornetsecurity: { selectors: ['hse1', 'hse2'], type: 'cname', target_contains: 'hornetsecurity.com', label: 'Hornetsecurity' },
  brevo:        { selectors: ['brevo1', 'brevo2', 'mail'], type: 'cname', target_contains: 'brevo.com', label: 'Brevo' },
  mailgun:      { selectors: ['pdk1', 'pdk2', 'smtp'], type: 'cname', target_contains: 'mailgun.org', label: 'Mailgun' },
  klaviyo:      { selectors: ['km1', 'km2'], type: 'cname', label: 'Klaviyo' },
  zoho:         { selectors: ['zoho', 'zmail'], type: 'txt', label: 'Zoho Mail' },
  zendesk:      { selectors: ['zendesk1', 'zendesk2'], type: 'cname', target_contains: 'dkim.zendesk.com', label: 'Zendesk' },
  protonmail:   { selectors: ['protonmail', 'protonmail2', 'protonmail3'], type: 'cname', label: 'Proton Mail' },
  icloud:       { selectors: ['sig1'], type: 'cname', target_contains: 'icloudmailadmin.com', label: 'Apple iCloud+' },
  mailjet:      { selectors: ['mailjet'], type: 'txt', label: 'Mailjet' },
};

// ── Tier 2: generic / self-host fallback selectors. Worth probing (cPanel,
//    OpenDKIM), but a hit says little about which sender. Low signal. ─────────
const GENERIC_FALLBACK_SELECTORS = [
  'default', 'dkim', 'mail', 'dkim1', 'dkim2', 'k1', 'k2', 's1', 's2',
  'selector', 'key1', 'key2', 'smtp', 'email', 'mxvault',
];

// ── Tier 3: NOT probeable. If one of these is the detected sender and nothing
//    in the catalog answers, the verdict is `indeterminate`, NEVER fail —
//    failing per-account/random selectors manufactures false alarms.
//    Inbound gateways (proofpoint/mimecast/barracuda) live here too: their MX
//    presence does not imply a fixed outbound DKIM selector on this domain. ──
const DYNAMIC_UNPROBEABLE = new Set([
  'amazonses', 'salesforce', 'mimecast', 'postmark', 'sparkpost',
  'constantcontact', 'activecampaign', 'freshdesk', 'intercom', 'hubspot',
  'proofpoint', 'barracuda',
]);

// Human-readable brand labels for detected providers that have no PROBEABLE
// entry (proper nouns — intentionally NOT translated; surfaced via i18n params).
const DYNAMIC_LABELS = {
  amazonses: 'Amazon SES', salesforce: 'Salesforce', mimecast: 'Mimecast',
  postmark: 'Postmark', sparkpost: 'SparkPost', constantcontact: 'Constant Contact',
  activecampaign: 'ActiveCampaign', freshdesk: 'Freshdesk', intercom: 'Intercom',
  hubspot: 'HubSpot', proofpoint: 'Proofpoint', barracuda: 'Barracuda',
};

// ── Detection signals ────────────────────────────────────────────────────────
const MX_DETECTION = {
  microsoft365:   ['mail.protection.outlook.com'],
  google:         ['aspmx.l.google.com', 'googlemail.com'],
  proofpoint:     ['pphosted.com', 'ppe-hosted.com'],
  mimecast:       ['mimecast.com'],
  hornetsecurity: ['hornetsecurity.com', 'antispameurope.com'],
  barracuda:      ['barracudanetworks.com'],
  zoho:           ['zoho.com', 'zoho.eu'],
};

const SPF_DETECTION = {
  microsoft365:    ['spf.protection.outlook.com'],
  google:          ['_spf.google.com'],
  sendgrid:        ['sendgrid.net'],
  mailchimp:       ['servers.mcsv.net'],
  hubspot:         ['_spf.hubspot.com'],
  amazonses:       ['amazonses.com'],
  constantcontact: ['spf.constantcontact.com'],
};

/** Lowercase + trim a hostname for substring matching. */
function norm(h) { return String(h || '').toLowerCase().replace(/\.$/, '').trim(); }

/**
 * Detect providers from MX hostnames and SPF include domains.
 * @param {object} sig  { mxHosts: string[], spfIncludes: string[] }
 * @returns {{ mx: string[], spf: string[], all: string[] }}
 */
function detectProviders({ mxHosts = [], spfIncludes = [] } = {}) {
  const mx = new Set();
  const spf = new Set();
  const mxN = mxHosts.map(norm);
  const spfN = spfIncludes.map(norm);

  for (const [provider, needles] of Object.entries(MX_DETECTION)) {
    if (needles.some(n => mxN.some(h => h.includes(n)))) mx.add(provider);
  }
  for (const [provider, needles] of Object.entries(SPF_DETECTION)) {
    if (needles.some(n => spfN.some(h => h.includes(n)))) spf.add(provider);
  }
  const all = new Set([...mx, ...spf]);
  return { mx: [...mx], spf: [...spf], all: [...all] };
}

/** True if a detected provider has fixed selectors we expect to resolve. */
function expectsFixedDkim(provider) {
  return Object.prototype.hasOwnProperty.call(PROBEABLE_SELECTORS, provider);
}

/** Human label for any provider key (probeable or dynamic), else the key. */
function providerLabel(provider) {
  return (PROBEABLE_SELECTORS[provider] && PROBEABLE_SELECTORS[provider].label)
    || DYNAMIC_LABELS[provider] || provider;
}

/**
 * The full probe plan: every tier-1 fixed selector (tagged with its provider +
 * expected CNAME target) followed by the tier-2 generic fallbacks. The reader
 * probes all of them regardless of detection; detection only weighs the result.
 * @returns {Array<{selector,type,provider,target_contains,tier}>}
 */
function buildProbePlan() {
  const plan = [];
  const seen = new Set();
  for (const [provider, cfg] of Object.entries(PROBEABLE_SELECTORS)) {
    for (const sel of cfg.selectors) {
      const key = `${sel}|${provider}`;
      if (seen.has(key)) continue;
      seen.add(key);
      plan.push({ selector: sel, type: cfg.type, provider, target_contains: cfg.target_contains || null, tier: 1 });
    }
  }
  for (const sel of GENERIC_FALLBACK_SELECTORS) {
    plan.push({ selector: sel, type: 'either', provider: null, target_contains: null, tier: 2 });
  }
  return plan;
}

module.exports = {
  PROBEABLE_SELECTORS,
  GENERIC_FALLBACK_SELECTORS,
  DYNAMIC_UNPROBEABLE,
  DYNAMIC_LABELS,
  MX_DETECTION,
  SPF_DETECTION,
  detectProviders,
  expectsFixedDkim,
  providerLabel,
  buildProbePlan,
  norm,
};
