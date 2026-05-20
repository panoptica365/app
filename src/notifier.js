/**
 * Panoptica365 — Email Notification System (Phase 3)
 * SMTP via Nodemailer with configurable PSA attribution.
 * Per-policy routing: support (PSA), personal, both, none.
 * Recipients and attribution configured in Settings → Notification Settings.
 */

const nodemailer = require('nodemailer');
const config = require('../config/default');
const db = require('./db/database');
const usersStore = require('./users-store');
const tenantMode = require('./lib/tenant-mode');
const i18n = require('./i18n');

let transporter = null;

// ─── Mute cache (Apr 28, 2026) ───
// `getMutedEmails()` is cheap (single indexed query), but every alert email
// path calls it. Cache for 60s in-process — staleness window is well under
// the polling cadence and matches Panoptica's existing tolerances. Cache
// invalidates immediately on the same process if a mute is created or
// revoked via api-user-prefs (POST/DELETE clear this cache).
let _muteCache = { ts: 0, emails: [] };
const MUTE_CACHE_MS = 60 * 1000;
async function getMutedEmailsCached() {
  const now = Date.now();
  if (now - _muteCache.ts < MUTE_CACHE_MS) return _muteCache.emails;
  const emails = await usersStore.getMutedEmails();
  _muteCache = { ts: now, emails };
  return emails;
}
function invalidateMuteCache() { _muteCache.ts = 0; }

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.auth.user,
        pass: config.smtp.auth.pass,
      },
    });
  }
  return transporter;
}

// Friendly category labels (matches UI). Phase 9c (May 2, 2026): localized
// per-recipient — `lang` selects en/fr/es via the alerts.category.* namespace.
// Falls back to the raw token if a key is missing. When raw is missing
// entirely, returns the locale's "N/A" (notifier.email_chrome.not_available).
function categoryLabel(raw, lang) {
  const targetLang = lang || 'en';
  if (!raw) {
    return getEmailChromeLabels(targetLang).notAvailable;
  }
  const key = 'alerts.category.' + raw;
  const translated = i18n.t(key, { lang: targetLang });
  return translated === key ? raw : translated;
}

// Slugify a policy/prefix name → snake_case key for alert_policy_names /
// alert_message_prefix lookups. Mirror of the client-side slugify in
// public/js/shared/i18n.js and the policySlug() in alert-engine.js.
function slugify(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Resolve PSA email address from config (live-reloaded).
 */
function getPsaEmail() {
  return (config.notification?.psaEmail || '').trim();
}

/**
 * Resolve personal/email notification addresses from config (live-reloaded).
 * Returns array of trimmed, non-empty addresses.
 */
function getNotifyEmails() {
  const raw = config.notification?.notifyEmails || '';
  return raw.split(',').map(e => e.trim()).filter(Boolean);
}

/**
 * Build the PSA attribution tag for a tenant.
 * Template from config, e.g. "//${PSA_NAME}//" → "//Laboratoire M2//"
 */
function buildAttribution(tenant) {
  const template = (config.notification?.psaAttribution || '').trim();
  if (!template) return '';
  const psaName = tenant.psa_name || '';
  if (!psaName) return '';
  return template.replace(/\$\{PSA_NAME\}/g, psaName);
}

/**
 * Send an alert notification based on the policy's notification_target.
 *
 * @param {object} alert - Alert object with id, severity, message, notification_target, etc.
 * @param {object} tenant - Tenant object with display_name, psa_name
 */
async function sendAlertNotification(alert, tenant) {
  // Audit-only contract gate (defense-in-depth — alert-engine should already
  // have skipped evaluateTenant for audit_only, so this should never fire,
  // but if any future code path queues an alert for an audit_only tenant we
  // want to refuse to email it instead of spamming the operator/customer).
  // Reads the in-process tenant-mode cache, so the cost is negligible.
  if (tenant && tenant.id && !await tenantMode.shouldProcessTenant(tenant.id)) {
    console.warn(`[Notifier] Refusing to send alert ${alert.id} — tenant ${tenant.id} is audit_only (defense-in-depth — investigate why this code path was reached)`);
    return;
  }

  const target = alert.notification_target;
  if (target === 'none') return;

  // Check throttling
  if (!await canSendNotification(alert, tenant)) {
    console.log(`[Notifier] Throttled: alert ${alert.id} (${alert.severity}/${alert.policy_name})`);
    return;
  }

  const configuredRecipients = [];
  if (target === 'support' || target === 'both') {
    const psa = getPsaEmail();
    if (psa) configuredRecipients.push(psa);
  }
  if (target === 'personal' || target === 'both') {
    configuredRecipients.push(...getNotifyEmails());
  }

  if (configuredRecipients.length === 0) {
    console.warn(`[Notifier] No recipients configured for target "${target}" — skipping alert ${alert.id}`);
    return;
  }

  // ─── Mute filter (Apr 28, 2026) ───
  // Subtract any addresses that have an active mute. If filtering empties
  // the recipient list, fall back to all role='admin' users with non-NULL
  // email (Version A failsafe per Jacques' decision: failsafe overrides
  // admins' own mute, since SOMEONE needs to see the alert).
  let mutedEmails = [];
  try {
    mutedEmails = await getMutedEmailsCached();
  } catch (muteErr) {
    console.warn(`[Notifier] Mute lookup failed (treating all as not-muted): ${muteErr.message}`);
  }
  const mutedSet = new Set(mutedEmails);
  let recipients = configuredRecipients.filter(r => !mutedSet.has((r || '').toLowerCase()));
  let usedFailsafe = false;
  let failsafeReason = null;

  if (recipients.length === 0) {
    // All configured recipients are muted. Send to admins as failsafe.
    try {
      const adminRecipients = await usersStore.getAdminFailsafeRecipients();
      if (adminRecipients.length > 0) {
        recipients = adminRecipients;
        usedFailsafe = true;
        failsafeReason = 'all_recipients_muted';
        console.warn(`[Notifier] All configured recipients muted for alert ${alert.id}; falling back to ${adminRecipients.length} admin recipient(s)`);
      } else {
        // No admins with email either. Last-line failsafe: log loudly, drop.
        console.error(`[Notifier] All configured recipients muted AND no admin failsafe recipients available for alert ${alert.id}. Email dropped.`);
        return;
      }
    } catch (failsafeErr) {
      console.error(`[Notifier] Failsafe lookup failed for alert ${alert.id}: ${failsafeErr.message}. Email dropped.`);
      return;
    }
  }

  // ─── Per-recipient language routing (Phase 9c — May 2, 2026) ───
  // Resolve each recipient's preferred language from the `users` table
  // (case-insensitive email match) in ONE query, then send personalized
  // emails — subject + body chrome + alert message all rendered in the
  // recipient's locale. Recipients not in the users table OR with NULL
  // language fall back to 'en'. If the lookup fails entirely, treat all
  // recipients as English so the alert still ships.
  let recipientLangs = new Map();
  try {
    const lower = recipients.map(e => (e || '').toLowerCase()).filter(Boolean);
    if (lower.length > 0) {
      const placeholders = lower.map(() => '?').join(',');
      const rows = await db.queryRows(
        `SELECT LOWER(email) AS email, language FROM users WHERE LOWER(email) IN (${placeholders})`,
        lower
      );
      for (const row of rows) {
        if (row.email && row.language && ['en', 'fr', 'es'].includes(row.language)) {
          recipientLangs.set(row.email, row.language);
        }
      }
    }
  } catch (langErr) {
    console.warn(`[Notifier] users table lookup failed for alert ${alert.id}; defaulting all recipients to English: ${langErr.message}`);
  }

  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 30 * 1000;
  let anyDelivered = false;

  for (const recipient of recipients) {
    const lang = recipientLangs.get((recipient || '').toLowerCase()) || 'en';

    // Render the alert message body in the recipient's locale (Phase 9b
    // structured payload → translated string; legacy alerts pass through
    // their stored English `message` column unchanged).
    const localizedMessage = renderAlertMessageForLocale(alert, lang);
    const subject = buildSubject(alert, tenant, lang, localizedMessage);
    let html = buildEmailHtml(alert, tenant, lang, localizedMessage);

    if (usedFailsafe) {
      const labels = getEmailChromeLabels(lang);
      const banner = `
        <div style="background:#fff8dc;border:1px solid #d4a017;color:#5a3a00;padding:12px;margin-bottom:16px;border-radius:4px;font-family:Inter,sans-serif;font-size:0.9rem;">
          <strong>${escHtml(labels.failsafeBannerTitle)}</strong> ${escHtml(labels.failsafeBannerBody)}
        </div>`;
      html = banner + html;
    }

    let delivered = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 1) {
          transporter = null; // Clear stale SMTP connection between retries.
        }
        const mailer = getTransporter();
        await mailer.sendMail({
          from: config.smtp.from,
          to: recipient,
          subject,
          html,
        });
        if (usedFailsafe) {
          console.log(`[Notifier] FAILSAFE email sent for alert ${alert.id} (reason=${failsafeReason}) to ${recipient} (${lang}, attempt ${attempt}/${MAX_RETRIES})`);
        } else {
          console.log(`[Notifier] Email sent for alert ${alert.id} to ${recipient} (${lang}, attempt ${attempt}/${MAX_RETRIES})`);
        }
        delivered = true;
        anyDelivered = true;
        break;
      } catch (err) {
        console.error(`[Notifier] Email send to ${recipient} failed for alert ${alert.id} (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`);
        if (attempt < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }
    if (!delivered) {
      console.error(`[Notifier] *** ALL RETRY ATTEMPTS EXHAUSTED for ${recipient} on alert ${alert.id} ***`);
    }
  }

  if (anyDelivered) {
    try {
      await db.execute('UPDATE alerts SET email_sent = TRUE WHERE id = ?', [alert.id]);
    } catch (markErr) {
      console.warn(`[Notifier] Could not mark alert ${alert.id} as email_sent: ${markErr.message}`);
    }
    if (mutedEmails.length) {
      console.log(`[Notifier] (${mutedEmails.length} muted address(es) excluded for alert ${alert.id})`);
    }
  }
}

/**
 * Build the email subject — alert title only, no company prefix.
 * The //Company// tag goes in the email body instead (for Autotask parsing).
 *
 * Phase 9c (May 2, 2026): subject is now locale-aware. The severity tag uses
 * the per-locale upper-case label (alerts.severity → fr "ÉLEVÉE", es "ALTA").
 * `localizedMessage` carries the already-translated body line.
 */
function buildSubject(alert, tenant, lang, localizedMessage) {
  const sev = alert.severity || 'info';
  // Reuse alerts.<severity> labels (existing keys: severe/high/medium/low/info)
  // and upper-case them for the [TAG] display.
  const sevLabel = i18n.t('alerts.' + sev, { lang: lang || 'en' });
  const tag = (sevLabel === 'alerts.' + sev ? sev : sevLabel).toUpperCase();
  const message = localizedMessage || alert.message || '';
  return `[${tag}] ${message}`;
}

/**
 * Render an alert message in the recipient's locale.
 *
 * Phase 9c (May 2, 2026) — server-side mirror of the frontend
 * resolveTemplateParams + renderAlertMessage helpers in
 * public/js/pages/alerts.js. Three paths, in order:
 *
 *   Path 1: structured payload (Phase 9b raw_data.message_template_key /
 *           message_template_params). Resolves *NameKey/*NameFallback into
 *           {<base>Name}, generic *Key/*Fallback into {<base>}, and the
 *           security-drift legacy interpretedKey/interpretedParams into
 *           {interpretedText}. Calls i18n.t(template_key, resolved, lang).
 *
 *   Path 2: legacy `policy_name + ":" + detail` messages — slug the
 *           policy_name, look up alert_policy_names.<slug>, and replace the
 *           prefix while keeping the (still-English) detail unchanged.
 *
 *   Path 3: known custom prefixes (CA + Intune drift) translated via
 *           alert_message_prefix.<slug>.
 *
 * Falls back to alert.message at every failure point so legacy/pre-9b
 * alerts still ship in English.
 */
function renderAlertMessageForLocale(alert, lang) {
  const targetLang = lang || 'en';

  let raw = alert.raw_data;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  raw = raw || {};

  // Path 1 — structured Phase 9b payload.
  const tplKey = raw.message_template_key;
  let tplParams = raw.message_template_params;
  if (typeof tplParams === 'string') {
    try { tplParams = JSON.parse(tplParams); } catch { tplParams = null; }
  }
  if (tplKey && tplParams && typeof tplParams === 'object') {
    try {
      const resolved = {};
      // Pass-through scalars first; *Key / *Fallback / interpretedParams are
      // metadata pairs handled in subsequent passes.
      for (const k of Object.keys(tplParams)) {
        if (k.endsWith('Key') || k.endsWith('Fallback') || k === 'interpretedParams') continue;
        resolved[k] = tplParams[k];
      }
      // <base>NameKey + <base>NameFallback → {<base>Name}
      for (const k of Object.keys(tplParams)) {
        if (!k.endsWith('NameKey')) continue;
        const base = k.substring(0, k.length - 'NameKey'.length);
        const fallback = tplParams[base + 'NameFallback'] || '';
        const v = tplParams[k];
        const translated = v ? i18n.t(v, { lang: targetLang }) : fallback;
        resolved[base + 'Name'] = (translated === v ? fallback : translated) || fallback;
      }
      // Generic <var>Key + <var>Fallback → {<var>}, skipping NameKey + interpretedKey.
      for (const k of Object.keys(tplParams)) {
        if (!k.endsWith('Key')) continue;
        if (k.endsWith('NameKey')) continue;
        if (k === 'interpretedKey') continue;
        const base = k.substring(0, k.length - 'Key'.length);
        const fallback = tplParams[base + 'Fallback'] || '';
        const v = tplParams[k];
        // Sub-template fragments may need the parent params for {placeholders}.
        const translated = v ? i18n.t(v, { ...tplParams, lang: targetLang }) : fallback;
        resolved[base] = (translated === v ? fallback : translated) || fallback;
      }
      // security_drift legacy: interpretedKey + interpretedParams → {interpretedText}
      if (tplParams.interpretedKey) {
        resolved.interpretedText = i18n.t(tplParams.interpretedKey, {
          ...(tplParams.interpretedParams || {}),
          lang: targetLang,
        });
      }
      const rendered = i18n.t(tplKey, { ...resolved, lang: targetLang });
      // i18n.t returns the key itself when the lookup fails — fall back if so.
      if (rendered && rendered !== tplKey) return rendered;
    } catch (e) {
      console.warn(`[Notifier] renderAlertMessageForLocale path-1 failed for alert ${alert.id}: ${e.message}`);
    }
  }

  const baseMessage = alert.message || '';

  // Path 2 — `${policy_name}: detail` legacy shape.
  if (alert.policy_name && typeof baseMessage === 'string') {
    const prefix = alert.policy_name + ':';
    if (baseMessage.startsWith(prefix)) {
      const slug = slugify(alert.policy_name);
      const lookupKey = 'alert_policy_names.' + slug;
      const translated = i18n.t(lookupKey, { lang: targetLang });
      if (translated && translated !== lookupKey && translated !== alert.policy_name) {
        return translated + baseMessage.substring(alert.policy_name.length);
      }
    }
  }

  // Path 3 — known custom prefixes.
  if (typeof baseMessage === 'string') {
    const customPrefixes = [
      'CA exemption list changed',
      'CA drift auto-remediated',
      'CA policy drift detected',
      'Intune policy drift',
    ];
    for (const englishPrefix of customPrefixes) {
      if (baseMessage.startsWith(englishPrefix + ':')) {
        const slug = slugify(englishPrefix);
        const lookupKey = 'alert_message_prefix.' + slug;
        const translated = i18n.t(lookupKey, { lang: targetLang });
        if (translated && translated !== lookupKey && translated !== englishPrefix) {
          return translated + baseMessage.substring(englishPrefix.length);
        }
        break;
      }
    }
  }

  return baseMessage;
}

/**
 * Check if we can send a notification (throttling).
 * Severe/High: always send immediately
 * Medium: configurable limit per day (default 24)
 * Low/Info: always send (but these are typically set to 'none' routing)
 */
async function canSendNotification(alert, tenant) {
  const severity = alert.severity;

  // Severe and High always send
  if (severity === 'severe' || severity === 'high') return true;

  // Medium: check daily limit
  if (severity === 'medium') {
    const limit = alert.notification_limit || 24;
    const sentToday = await db.queryOne(
      `SELECT COUNT(*) AS cnt FROM alerts
       WHERE tenant_id = ? AND policy_id = ? AND email_sent = TRUE
         AND triggered_at >= CURDATE()`,
      [tenant.id, alert.policy_id]
    );
    return (sentToday?.cnt || 0) < limit;
  }

  // Low/Info: always send if routing is configured
  return true;
}

/**
 * Build the HTML email body. Phase 9c (May 2, 2026): localized chrome via
 * getEmailChromeLabels(lang). The `localizedMessage` arg comes from
 * renderAlertMessageForLocale so the headline + subject stay in sync.
 *
 * The translated policy name is also rendered in the details table, slugged
 * via alert_policy_names.<slug>; falls back to the English DB string.
 */
function buildEmailHtml(alert, tenant, lang, localizedMessage) {
  const targetLang = lang || 'en';
  const L = getEmailChromeLabels(targetLang);

  const severityColors = {
    severe: '#e74c3c',
    high: '#e67e22',
    medium: '#f39c12',
    low: '#3498db',
    info: '#95a5a6',
  };

  const color = severityColors[alert.severity] || '#95a5a6';
  // Per-locale severity label for the badge (already in alerts.* namespace).
  const sevLabel = i18n.t('alerts.' + alert.severity, { lang: targetLang });
  const sevDisplay = (sevLabel === 'alerts.' + alert.severity ? alert.severity : sevLabel);

  // Format AI analysis: convert newlines to <br>, bold the section headers.
  // Section labels match the rewritten April 2026 Haiku prompt:
  //   PROPOSED_SEVERITY, SEVERITY_REASON, EXPLANATION, ACTION
  // Legacy labels (RISK LEVEL, CORRELATIONS, RECOMMENDED ACTIONS) kept for
  // backwards compatibility with any old alerts re-rendered.
  const formatAiHtml = (text) => {
    let html = escHtml(text);
    // Gold for the verdict line
    html = html.replace(/^(PROPOSED_SEVERITY:.*)/gm, '<strong style="color:#f0c040">$1</strong>');
    html = html.replace(/^(RISK LEVEL:.*)/gm, '<strong style="color:#f0c040">$1</strong>');
    // Purple-grey for the body sections
    html = html.replace(
      /^(SEVERITY_REASON:|EXPLANATION:|ACTION:|CORRELATIONS:|RECOMMENDED ACTIONS:)/gm,
      '<br><strong style="color:#9999cc">$1</strong>'
    );
    // Convert newlines to <br>
    html = html.replace(/\n/g, '<br>');
    return html;
  };

  // Pick the AI analysis copy in the recipient's locale. Phase 9c — alert
  // engine now exposes ai_analysis_en/fr/es on the in-memory alert. Falls
  // back to English when fr/es weren't translated, then to the legacy
  // ai_analysis field (set to ai_analysis_en in alert-engine.js, but also
  // possible on legacy/external alert payloads that pre-date Phase 9a).
  const aiPerLocale = (
    (targetLang === 'fr' && alert.ai_analysis_fr)
    || (targetLang === 'es' && alert.ai_analysis_es)
    || alert.ai_analysis_en
    || alert.ai_analysis
  );
  const aiSection = aiPerLocale
    ? `<div style="background:#1a1a2e;border:1px solid #334477;border-radius:6px;padding:16px;margin:16px 0">
         <div style="font-size:12px;color:#9999cc;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">${escHtml(L.aiAnalysisLabel)}</div>
         <div style="color:#e0e0e0;font-size:14px;line-height:1.6">${formatAiHtml(aiPerLocale)}</div>
       </div>`
    : '';

  const recurrenceNote = alert.recurrence_count > 1
    ? `<div style="color:#f39c12;font-size:13px;margin-top:8px">⟳ ${escHtml(L.recurrence.replace('{count}', alert.recurrence_count))}</div>`
    : '';

  // PSA attribution tag — first line of body for ticket matching
  const companyTag = buildAttribution(tenant);

  // Translate policy_name via alert_policy_names.<slug>; fall back to the
  // English DB string if no key (graceful for new policies). N/A localized.
  let policyDisplay = alert.policy_name || L.notAvailable;
  if (alert.policy_name) {
    const slug = slugify(alert.policy_name);
    const lookupKey = 'alert_policy_names.' + slug;
    const translated = i18n.t(lookupKey, { lang: targetLang });
    if (translated && translated !== lookupKey) policyDisplay = translated;
  }

  // Date/time string in recipient locale.
  const dateLocale = targetLang === 'fr' ? 'fr-CA' : (targetLang === 'es' ? 'es' : 'en-CA');
  const timestampStr = new Date().toLocaleString(dateLocale, { timeZone: config.timezone });

  const headline = localizedMessage || alert.message || '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0a0a1a;color:#e0e0e0;font-family:Segoe UI,Arial,sans-serif;margin:0;padding:20px">
  ${companyTag ? `<div style="font-size:14px;color:#e0e0e0;margin-bottom:12px">${escHtml(companyTag)}</div>` : ''}
  <div style="max-width:640px;margin:0 auto">
    <!-- Header -->
    <div style="background:linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);border-radius:8px 8px 0 0;padding:20px;border-bottom:3px solid ${color}">
      <div style="display:inline-block;background:${color};color:#fff;font-weight:bold;font-size:11px;letter-spacing:1px;padding:4px 12px;border-radius:12px;text-transform:uppercase">${escHtml(sevDisplay)}</div>
      <div style="font-size:20px;font-weight:600;color:#fff;margin-top:12px">${escHtml(headline)}</div>
      <div style="font-size:13px;color:#9999cc;margin-top:6px">${escHtml(tenant.display_name)} — ${escHtml(timestampStr)}</div>
      ${recurrenceNote}
    </div>

    <!-- Details -->
    <div style="background:#12122a;padding:20px;border:1px solid #334477;border-top:none">
      <table style="width:100%;font-size:14px;color:#ccc" cellpadding="6">
        <tr><td style="color:#9999cc;width:120px">${escHtml(L.category)}</td><td>${escHtml(categoryLabel(alert.category, targetLang))}</td></tr>
        <tr><td style="color:#9999cc">${escHtml(L.policy)}</td><td>${escHtml(policyDisplay)}</td></tr>
        <tr><td style="color:#9999cc">${escHtml(L.tenant)}</td><td>${escHtml(tenant.display_name)}</td></tr>
        <tr><td style="color:#9999cc">${escHtml(L.alertId)}</td><td>#${alert.id}</td></tr>
      </table>
    </div>

    ${aiSection}

    <!-- Footer -->
    <div style="background:#1a1a2e;border-radius:0 0 8px 8px;padding:16px;border:1px solid #334477;border-top:none;text-align:center">
      ${config.baseUrl ? `<a href="${config.baseUrl}/?page=alerts" style="color:#4488ff;text-decoration:none;font-size:13px">${escHtml(L.viewInDashboard)}</a>` : ''}
      <div style="font-size:11px;color:#666;margin-top:8px">${escHtml(L.footer)}</div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Locale labels for the alert-email HTML chrome. Mirror of the morning
 * briefing's getEmailChromeLabels — inline rather than a JSON round-trip,
 * because alerts can fire before locale files reload, and email chrome is
 * small enough that this is more legible.
 *
 * Phase 9c (May 2, 2026).
 */
function getEmailChromeLabels(lang) {
  const labels = {
    en: {
      aiAnalysisLabel: 'AI Analysis (Claude Haiku)',
      category: 'Category',
      policy: 'Policy',
      tenant: 'Tenant',
      alertId: 'Alert ID',
      viewInDashboard: 'View in Panoptica365 Dashboard →',
      footer: 'Panoptica365 — Multi-Tenant M365 Monitoring',
      recurrence: 'This condition has been detected {count} times',
      notAvailable: 'N/A',
      failsafeBannerTitle: '⚠ Failsafe delivery',
      failsafeBannerBody: '— this alert was originally routed to recipients who have all muted alerts. It was redirected to administrators because someone needs to see it.',
    },
    fr: {
      aiAnalysisLabel: 'Analyse IA (Claude Haiku)',
      category: 'Catégorie',
      policy: 'Stratégie',
      tenant: 'Locataire',
      alertId: 'ID de l’alerte',
      viewInDashboard: 'Ouvrir le tableau de bord Panoptica365 →',
      footer: 'Panoptica365 — Surveillance M365 multi-locataire',
      recurrence: 'Cette condition a été détectée {count} fois',
      notAvailable: 'S.O.',
      failsafeBannerTitle: '⚠ Livraison de secours',
      failsafeBannerBody: '— cette alerte avait été acheminée à des destinataires qui ont tous mis les alertes en sourdine. Elle a été redirigée vers les administrateurs parce que quelqu’un doit la voir.',
    },
    es: {
      aiAnalysisLabel: 'Análisis de IA (Claude Haiku)',
      category: 'Categoría',
      policy: 'Política',
      tenant: 'Inquilino',
      alertId: 'ID de alerta',
      viewInDashboard: 'Abrir el panel Panoptica365 →',
      footer: 'Panoptica365 — Monitoreo M365 multi-inquilino',
      recurrence: 'Esta condición se ha detectado {count} veces',
      notAvailable: 'N/D',
      failsafeBannerTitle: '⚠ Entrega de respaldo',
      failsafeBannerBody: '— esta alerta estaba dirigida a destinatarios que han silenciado todas las alertas. Se redirigió a los administradores porque alguien tiene que verla.',
    },
  };
  return labels[lang] || labels.en;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Reset cached transporter (called when SMTP settings change). */
function _resetTransporter() {
  transporter = null;
}

module.exports = { sendAlertNotification, _resetTransporter, invalidateMuteCache };
