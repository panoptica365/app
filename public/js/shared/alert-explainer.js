/**
 * Panoptica — Shared Alert Explainer Modal
 *
 * Surfaces L1-grade educational content about each alert policy. Triggered
 * from:
 *   1. The Alert Policies admin page (ⓘ icon next to each policy name)
 *   2. The fired-alert detail slideout (ⓘ icon next to the Policy field)
 *
 * Both surfaces resolve to the same i18n key namespace:
 *   alert_explanations.<slug>.{what_is_this,why_it_matters,attack_vectors,
 *                              what_to_do,example_scenario}
 * where <slug> is computed from the policy name via PanopticaI18n.slugify().
 *
 * Public API:
 *   Panoptica.AlertExplainer.open(policyName)
 *   Panoptica.AlertExplainer.close()
 *   Panoptica.AlertExplainer.iconHtml({ size, dataAttr }) — returns the
 *     <span> markup for an inline ⓘ trigger. Caller is responsible for
 *     wiring the click handler (so we don't leak global delegation).
 *
 * Self-contained overlay (z-index 10001) — sits above the alert-slideout
 * (10000) and above Panoptica.openModal so it works from any surface
 * without stacking surprises.
 *
 * i18n: every visible string flows through alert_explanations.* keys; the
 * five section labels are also localized so adding a new locale is purely
 * a JSON addition. PanopticaI18n.applyTo() is called after innerHTML to
 * pick up any data-i18n descendants (defensive — current markup uses
 * inline t() calls so applyTo is a belt-and-suspenders measure).
 */
(function () {
  'use strict';

  const OVERLAY_ID = 'alert-explainer-overlay';
  const SECTIONS = [
    'what_is_this',
    'why_it_matters',
    'attack_vectors',
    'what_to_do',
    'example_scenario',
  ];

  let escHandler = null;

  function t(key, fallback) {
    if (window.PanopticaI18n && typeof window.PanopticaI18n.tOrFallback === 'function') {
      return window.PanopticaI18n.tOrFallback(key, fallback || key);
    }
    return fallback || key;
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  // ─── Content rendering ───
  //
  // The locale strings use a tiny markup convention:
  //   \n\n           → paragraph break
  //   "- " at line   → bullet list item (consecutive bullets join into one <ul>)
  // No other markup is interpreted; all text is HTML-escaped first.
  //
  // This keeps the locale files readable as plain prose while still letting
  // us produce structured output. Avoids dragging in a full Markdown parser
  // for what amounts to two formatting primitives.

  function renderProse(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const paragraphs = raw.split(/\n\n+/);
    const out = [];
    for (const para of paragraphs) {
      const lines = para.split('\n');
      const allBullets = lines.length > 0 && lines.every(l => /^\s*-\s+/.test(l));
      if (allBullets) {
        const items = lines.map(l => l.replace(/^\s*-\s+/, ''));
        out.push('<ul class="ax-list">' + items.map(i => `<li>${esc(i)}</li>`).join('') + '</ul>');
      } else {
        // Mixed content — render as a paragraph, but if any line starts with
        // "- ", break it visually with <br>· prefix to preserve the author's
        // intent without forcing a list. (Defensive — current content keeps
        // bullet runs in their own paragraphs.)
        out.push('<p class="ax-para">' + esc(para).replace(/\n/g, '<br>') + '</p>');
      }
    }
    return out.join('');
  }

  // ─── Mount + handlers ───

  function ensureStyles() {
    if (document.getElementById('alert-explainer-styles')) return;
    const css = `
      .ax-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.55);
        z-index: 10001;
        display: flex; align-items: center; justify-content: center;
        padding: 24px;
      }
      .ax-modal {
        background: var(--p-surface); color: var(--p-text);
        border: 1px solid var(--p-border);
        border-radius: 8px;
        width: min(760px, 96vw);
        max-height: 90vh; overflow: hidden;
        display: flex; flex-direction: column;
        box-shadow: 0 14px 48px rgba(0,0,0,0.55);
        font-family: Inter, system-ui, sans-serif;
      }
      .ax-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px 22px; border-bottom: 1px solid var(--p-border);
        gap: 16px;
      }
      .ax-head-titles { min-width: 0; }
      .ax-head h2 {
        margin: 0; font-size: 1.05rem; color: var(--p-text);
        font-weight: 600; letter-spacing: 0.01em;
      }
      .ax-head .ax-policy-name {
        font-size: 0.85rem; color: var(--p-text-muted);
        margin-top: 2px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .ax-close {
        background: transparent; border: none; cursor: pointer;
        color: var(--p-text-muted); font-size: 1.5rem; line-height: 1;
        padding: 0 4px;
      }
      .ax-close:hover { color: var(--p-text); }
      .ax-body {
        padding: 18px 22px 22px;
        overflow-y: auto;
        font-size: 0.9rem; line-height: 1.55;
      }
      .ax-section { margin-bottom: 18px; }
      .ax-section:last-child { margin-bottom: 0; }
      .ax-section-title {
        font-size: 0.78rem; font-weight: 600; letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--p-accent, var(--p-text));
        margin: 0 0 8px 0;
      }
      .ax-para { margin: 0 0 10px 0; color: var(--p-text); }
      .ax-para:last-child { margin-bottom: 0; }
      .ax-list { margin: 0 0 10px 0; padding-left: 20px; color: var(--p-text); }
      .ax-list li { margin-bottom: 6px; }
      .ax-list li:last-child { margin-bottom: 0; }
      .ax-empty {
        color: var(--p-text-muted); font-style: italic;
        padding: 24px 0; text-align: center;
      }
      /* Inline trigger icon — Lucide graduation-cap, used by both
         alert-policies page and slideout. The button is a hit target; the
         actual icon is rendered by Lucide from the inner <i data-lucide>
         after Panoptica.refreshIcons() runs. */
      .ax-icon-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 22px;
        border: none;
        border-radius: 4px;
        background: transparent; color: var(--p-text-muted);
        cursor: help; padding: 0;
        transition: color 0.12s, background 0.12s;
        vertical-align: middle;
        margin-left: 6px;
      }
      .ax-icon-btn:hover {
        color: var(--p-accent, var(--p-text));
        background: rgba(255,255,255,0.06);
      }
      .ax-icon-btn svg {
        width: 16px; height: 16px;
        stroke-width: 1.8;
        display: block;
      }
    `;
    const style = document.createElement('style');
    style.id = 'alert-explainer-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildBody(slug) {
    const lookups = SECTIONS.map(section => {
      const key = `alert_explanations.${slug}.${section}`;
      const raw = t(key, '');
      // tOrFallback returns the fallback ('') when missing; treat empty as missing.
      const present = !!raw && raw !== key;
      return { section, raw: present ? raw : null };
    });

    const anyContent = lookups.some(l => l.raw);
    if (!anyContent) {
      const placeholder = t('alert_explanations.no_content_yet',
        "A detailed explanation for this alert hasn't been written yet.");
      return `<div class="ax-empty">${esc(placeholder)}</div>`;
    }

    return lookups.map(({ section, raw }) => {
      if (!raw) return '';
      const title = t(`alert_explanations.section_${section}`, section);
      return `
        <section class="ax-section">
          <h3 class="ax-section-title">${esc(title)}</h3>
          ${renderProse(raw)}
        </section>
      `;
    }).join('');
  }

  function open(policyName) {
    if (!policyName) return;
    ensureStyles();
    close(); // tear down any prior instance

    const slug = (window.PanopticaI18n && typeof window.PanopticaI18n.slugify === 'function')
      ? window.PanopticaI18n.slugify(policyName)
      : String(policyName).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    const localizedName = (window.PanopticaI18n && typeof window.PanopticaI18n.tOrFallback === 'function')
      ? window.PanopticaI18n.tOrFallback('alert_policy_names.' + slug, policyName)
      : policyName;

    const title = t('alert_explanations.modal_title', 'About this alert');
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'ax-overlay';
    overlay.innerHTML = `
      <div class="ax-modal" role="dialog" aria-modal="true" aria-labelledby="ax-title">
        <header class="ax-head">
          <div class="ax-head-titles">
            <h2 id="ax-title">${esc(title)}</h2>
            <div class="ax-policy-name">${esc(localizedName)}</div>
          </div>
          <button type="button" class="ax-close" id="ax-close-btn"
                  aria-label="${esc(t('alerts.common.close', 'Close'))}">&times;</button>
        </header>
        <div class="ax-body" id="ax-body"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    const body = overlay.querySelector('#ax-body');
    body.innerHTML = buildBody(slug);

    // Belt-and-suspenders: any data-i18n attrs in dynamic markup get walked.
    if (window.PanopticaI18n && typeof window.PanopticaI18n.applyTo === 'function') {
      window.PanopticaI18n.applyTo(overlay);
    }

    // Wire close handlers
    overlay.querySelector('#ax-close-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
  }

  function close() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
    if (escHandler) {
      document.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
  }

  // ─── Inline icon helper ───
  //
  // Returns the HTML for a small ⓘ trigger button. Callers attach the
  // click handler themselves — keeps event delegation explicit and avoids
  // a global handler that could fire twice if a page re-renders.
  //
  // dataAttr (optional) lets the caller stash the policy name on the
  // element so the click handler can read it back without closure capture
  // (useful when rendering inside innerHTML strings).

  function iconHtml(opts) {
    opts = opts || {};
    const tooltip = t('alert_explanations.tooltip', 'Learn about this alert');
    const policyName = opts.policyName || '';
    const dataAttr = policyName
      ? ` data-ax-policy="${esc(policyName)}"`
      : '';
    const cls = opts.extraClass ? ` ${opts.extraClass}` : '';
    // Inner <i data-lucide="graduation-cap"> gets replaced by Lucide's SVG
    // after Panoptica.refreshIcons() runs. Callers MUST call refreshIcons
    // on a parent element (or on document) after injecting this markup,
    // otherwise the <i> tag stays as-is and no icon appears.
    return `<button type="button" class="ax-icon-btn${cls}"`
      + ` title="${esc(tooltip)}"`
      + ` aria-label="${esc(tooltip)}"`
      + dataAttr
      + `><i data-lucide="graduation-cap"></i></button>`;
  }

  // ─── Public API attachment ───
  //
  // Attached inside an init function rather than at module load to dodge
  // the historical window.Panoptica module-level wipe issue (per the
  // memory note about app.js reassigning the namespace). Calling code
  // hits Panoptica.AlertExplainer at click time, well after init().

  function attach() {
    if (!window.Panoptica) window.Panoptica = {};
    window.Panoptica.AlertExplainer = { open, close, iconHtml };
  }

  // Run attach immediately AND defensively on DOMContentLoaded — the file
  // is loaded after app.js so window.Panoptica exists, but we re-attach
  // on DOM-ready in case any later code clobbers the namespace.
  attach();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  }
})();
