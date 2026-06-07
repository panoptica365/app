/**
 * Panoptica365 — Shared EULA modal
 *
 * One component, three contexts (build spec §6.1):
 *   - Wizard welcome step  → mode 'accept' (non-blocking; Close returns to
 *                            the welcome screen, Agree advances the wizard)
 *   - Post-update re-accept → mode 'accept' + blocking:true (no escape; the
 *                            admin types their name and clicks Agree — the
 *                            gate overlay stays and nothing else is clickable
 *                            until acceptance is recorded)
 *   - Settings tile        → mode 'readonly' (no name field; shows the
 *                            provenance + acceptance history)
 *
 * The body is the EULA markdown rendered with the SAME renderer the Learn Hub
 * lessons use (window.PanopticaLearnMarkdown). The legal text is content, not
 * i18n keys — only the surrounding chrome is keyed (legal.eula.*).
 *
 * Public API (attached inside attach() to dodge the historical
 * window.Panoptica module-level wipe):
 *   Panoptica.EulaModal.open(opts)
 *   Panoptica.EulaModal.close()
 *
 * opts:
 *   mode      'accept' | 'readonly'         (default 'accept')
 *   locale    UI locale to request          (default current i18n lang)
 *   blocking  boolean — accept mode only; suppresses every dismiss path
 *   onAgree   async fn(result) run after a successful POST (then the modal
 *             closes). In the wizard this advances the step; in re-accept it
 *             reloads the shell.
 *
 * Works on both the main SPA (window.Panoptica present) and the standalone
 * wizard page (no app.js) — it only depends on window.PanopticaI18n and
 * window.PanopticaLearnMarkdown, both loaded ahead of it.
 */
(function () {
  'use strict';

  const OVERLAY_ID = 'eula-modal-overlay';
  let escHandler = null;

  // ─── tiny i18n + escape helpers (mirror alert-explainer.js) ───
  function t(key, fallback, params) {
    if (window.PanopticaI18n && typeof window.PanopticaI18n.tOrFallback === 'function') {
      const v = window.PanopticaI18n.tOrFallback(key, null, params);
      if (v !== null && v !== undefined) return v;
    }
    // Missing key — interpolate params into the supplied English fallback so
    // {name}/{date}/{version} never leak to the operator.
    return interpolate(fallback != null ? fallback : key, params);
  }

  function interpolate(str, params) {
    if (!params || typeof str !== 'string') return str;
    return str.replace(/\{(\w+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m);
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function currentLocale() {
    if (window.PanopticaI18n && typeof window.PanopticaI18n.currentLang === 'function') {
      return window.PanopticaI18n.currentLang() || 'en';
    }
    return 'en';
  }

  function renderMarkdown(md) {
    if (window.PanopticaLearnMarkdown && typeof window.PanopticaLearnMarkdown.render === 'function') {
      return window.PanopticaLearnMarkdown.render(md || '');
    }
    // Defensive fallback — the renderer should always be loaded ahead of us.
    return '<pre class="eula-raw">' + esc(md || '') + '</pre>';
  }

  // ─── date formatting (localized, per spec §6.3) ───
  function formatDate(iso, locale) {
    if (!iso) return '';
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return iso;
    try {
      return new Intl.DateTimeFormat(locale || 'en', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }).format(new Date(ms));
    } catch {
      return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
    }
  }

  // ─── network ───
  async function fetchEula(locale) {
    const qs = locale ? ('?lang=' + encodeURIComponent(locale)) : '';
    const res = await fetch('/api/legal/eula' + qs, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const e = new Error('HTTP ' + res.status);
      e.status = res.status;
      throw e;
    }
    return res.json();
  }

  async function postAccept(typedName, locale) {
    const res = await fetch('/api/legal/eula/accept', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ typed_name: typedName, locale }),
    });
    let body = {};
    try { body = await res.json(); } catch { /* */ }
    if (!res.ok) {
      const e = new Error(body.detail || body.error || ('HTTP ' + res.status));
      e.status = res.status;
      throw e;
    }
    return body;
  }

  // ─── styles ───
  function ensureStyles() {
    if (document.getElementById('eula-modal-styles')) return;
    const css = `
      .eula-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.6);
        z-index: 10050;
        display: flex; align-items: center; justify-content: center;
        padding: 24px;
      }
      .eula-modal {
        background: var(--p-surface, #fff); color: var(--p-text, #1a1a1a);
        border: 1px solid var(--p-border, #ddd);
        border-radius: 10px;
        width: min(900px, 80vw);
        max-height: 90vh;
        display: flex; flex-direction: column; overflow: hidden;
        box-shadow: 0 18px 56px rgba(0,0,0,0.6);
        font-family: Inter, system-ui, sans-serif;
      }
      .eula-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px 24px; border-bottom: 1px solid var(--p-border, #ddd);
        gap: 16px; flex: 0 0 auto;
      }
      .eula-head h2 {
        margin: 0; font-size: 1.1rem; font-weight: 600; letter-spacing: 0.01em;
      }
      .eula-close-x {
        background: transparent; border: none; cursor: pointer;
        color: var(--p-text-muted, #888); font-size: 1.6rem; line-height: 1;
        padding: 0 4px;
      }
      .eula-close-x:hover { color: var(--p-text, #000); }
      .eula-body {
        padding: 20px 24px; overflow-y: auto;
        font-size: 0.92rem; line-height: 1.6; flex: 1 1 auto;
      }
      .eula-notice {
        background: var(--p-warning-muted, #fff6e0);
        border: 1px solid var(--p-warning, #e0a800);
        color: var(--p-text, #1a1a1a);
        border-radius: 6px; padding: 12px 14px; margin-bottom: 18px;
        font-size: 0.9rem;
      }
      .eula-provenance {
        background: var(--p-surface-2, #f6f7f9);
        border: 1px solid var(--p-border, #e2e4e8);
        border-radius: 6px; padding: 12px 14px; margin-bottom: 18px;
        font-size: 0.9rem;
      }
      .eula-provenance .eula-prov-line { font-weight: 600; }
      .eula-history { margin-top: 10px; }
      .eula-history > summary { cursor: pointer; font-weight: 600; }
      .eula-history table {
        width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 0.85rem;
      }
      .eula-history th, .eula-history td {
        text-align: left; padding: 6px 8px;
        border-bottom: 1px solid var(--p-border, #e2e4e8);
      }
      .eula-foot {
        flex: 0 0 auto; border-top: 1px solid var(--p-border, #ddd);
        padding: 16px 24px; background: var(--p-surface, #fff);
      }
      .eula-name-label {
        display: block; font-size: 0.85rem; color: var(--p-text-muted, #555);
        margin-bottom: 6px;
      }
      .eula-name-input {
        width: 100%; box-sizing: border-box;
        padding: 9px 12px; font-size: 0.95rem;
        border: 1px solid var(--p-border, #ccc); border-radius: 6px;
        /* Fixed light scheme: the EULA name field is a white box, so force
           dark text. Do NOT use var(--p-text) here — under the dark app theme
           it resolves to a light colour and renders white-on-white (the field
           looked empty until you select-all). Self-consistent literals can't
           flip on any theme. */
        background: #fff; color: #1a1a1a;
        margin-bottom: 12px;
      }
      .eula-foot-actions {
        display: flex; justify-content: flex-end; gap: 10px;
      }
      .eula-btn {
        padding: 9px 18px; font-size: 0.9rem; font-weight: 600;
        border-radius: 6px; cursor: pointer; border: 1px solid transparent;
      }
      .eula-btn-secondary {
        background: transparent; color: var(--p-text, #1a1a1a);
        border-color: var(--p-border, #ccc);
      }
      .eula-btn-secondary:hover { background: var(--p-surface-2, #f1f2f4); }
      .eula-btn-primary {
        background: var(--p-accent, #2563eb); color: #fff;
      }
      .eula-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
      .eula-error {
        color: var(--p-danger, #d33); font-size: 0.85rem; margin-bottom: 10px;
        min-height: 1em;
      }
    `;
    const style = document.createElement('style');
    style.id = 'eula-modal-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ─── provenance block (readonly mode) ───
  function buildProvenance(data, locale) {
    const acc = data.acceptance;
    if (!acc) {
      return `<div class="eula-provenance"><div class="eula-prov-line">${esc(
        t('legal.eula.notAccepted', 'Not yet accepted')
      )}</div></div>`;
    }
    const line = t('legal.eula.acceptedBy', 'Accepted by {name} on {date} — version {version}', {
      name: acc.typed_name,
      date: formatDate(acc.accepted_at, locale),
      version: acc.eula_version,
    });

    let history = '';
    if (Array.isArray(data.history) && data.history.length > 1) {
      const rows = data.history.map((h) => `
        <tr>
          <td>${esc(h.typed_name)}</td>
          <td>${esc(h.eula_version)}</td>
          <td>${esc(formatDate(h.accepted_at, locale))}</td>
          <td>${esc(h.context)}</td>
        </tr>`).join('');
      history = `
        <details class="eula-history">
          <summary>${esc(t('legal.eula.historyTitle', 'Acceptance history'))}</summary>
          <table>
            <tbody>${rows}</tbody>
          </table>
        </details>`;
    }
    return `<div class="eula-provenance"><div class="eula-prov-line">${esc(line)}</div>${history}</div>`;
  }

  // ─── open / close ───
  function close() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
    if (escHandler) {
      document.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
  }

  async function open(opts) {
    opts = opts || {};
    const mode = opts.mode === 'readonly' ? 'readonly' : 'accept';
    const blocking = mode === 'accept' && !!opts.blocking;
    const locale = opts.locale || currentLocale();

    ensureStyles();
    close(); // tear down any prior instance

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'eula-overlay';
    const title = t('legal.eula.modalTitle', 'End User License Agreement');
    const closeXmarkup = blocking
      ? ''
      : `<button type="button" class="eula-close-x" id="eula-close-x" aria-label="${esc(t('legal.eula.closeButton', 'Close'))}">&times;</button>`;

    overlay.innerHTML = `
      <div class="eula-modal" role="dialog" aria-modal="true" aria-labelledby="eula-modal-title">
        <header class="eula-head">
          <h2 id="eula-modal-title">${esc(title)}</h2>
          ${closeXmarkup}
        </header>
        <div class="eula-body" id="eula-modal-body">
          <p>${esc(t('common.loading', 'Loading…'))}</p>
        </div>
        <footer class="eula-foot" id="eula-modal-foot"></footer>
      </div>
    `;
    document.body.appendChild(overlay);

    const bodyEl = overlay.querySelector('#eula-modal-body');
    const footEl = overlay.querySelector('#eula-modal-foot');

    // Dismiss wiring — suppressed entirely in blocking mode.
    if (!blocking) {
      const x = overlay.querySelector('#eula-close-x');
      if (x) x.addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      escHandler = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', escHandler);
    }

    // Load content.
    let data;
    try {
      data = await fetchEula(locale);
    } catch (err) {
      bodyEl.innerHTML = `<p class="eula-error">${esc(
        t('legal.eula.loadError', 'Could not load the license agreement. Please try again.')
      )}</p>`;
      footEl.innerHTML = blocking
        ? `<div class="eula-foot-actions"><button type="button" class="eula-btn eula-btn-primary" id="eula-retry">${esc(t('setup.reconnect.retry', 'Check again'))}</button></div>`
        : `<div class="eula-foot-actions"><button type="button" class="eula-btn eula-btn-secondary" id="eula-close-btn">${esc(t('legal.eula.closeButton', 'Close'))}</button></div>`;
      const retry = overlay.querySelector('#eula-retry');
      if (retry) retry.addEventListener('click', () => open(opts));
      const cb = overlay.querySelector('#eula-close-btn');
      if (cb) cb.addEventListener('click', close);
      return;
    }

    const localeServed = data.locale || locale;
    const noticeMarkup = blocking
      ? `<div class="eula-notice">${esc(t('legal.eula.reacceptNotice', 'The license agreement has been updated. An administrator must review and accept it to continue.'))}</div>`
      : '';
    const provenanceMarkup = mode === 'readonly' ? buildProvenance(data, localeServed) : '';

    bodyEl.innerHTML = noticeMarkup + provenanceMarkup +
      '<div class="eula-content learn-content">' + renderMarkdown(data.content) + '</div>';

    // Pick up any data-i18n chrome we injected (defensive — current markup
    // uses inline t() so this is belt-and-suspenders).
    if (window.PanopticaI18n && typeof window.PanopticaI18n.applyTo === 'function') {
      window.PanopticaI18n.applyTo(overlay);
    }

    if (mode === 'readonly') {
      footEl.innerHTML = `
        <div class="eula-foot-actions">
          <button type="button" class="eula-btn eula-btn-secondary" id="eula-close-btn">${esc(t('legal.eula.closeButton', 'Close'))}</button>
        </div>`;
      overlay.querySelector('#eula-close-btn').addEventListener('click', close);
      return;
    }

    // Accept mode — name field (helper ABOVE the input, per house form rules)
    // + Agree (disabled until ≥2 trimmed chars) + optional Close.
    const closeBtnMarkup = blocking
      ? ''
      : `<button type="button" class="eula-btn eula-btn-secondary" id="eula-close-btn">${esc(t('legal.eula.closeButton', 'Close'))}</button>`;
    footEl.innerHTML = `
      <label class="eula-name-label" for="eula-name-input">${esc(t('legal.eula.nameHelper', 'Type your full name to confirm you have read and agree to this agreement'))}</label>
      <input type="text" class="eula-name-input" id="eula-name-input"
             autocomplete="off" placeholder="${esc(t('legal.eula.namePlaceholder', 'Full name'))}">
      <div class="eula-error" id="eula-accept-error"></div>
      <div class="eula-foot-actions">
        ${closeBtnMarkup}
        <button type="button" class="eula-btn eula-btn-primary" id="eula-agree-btn" disabled>${esc(t('legal.eula.agreeButton', 'Agree and Continue'))}</button>
      </div>`;

    const nameInput = overlay.querySelector('#eula-name-input');
    const agreeBtn = overlay.querySelector('#eula-agree-btn');
    const errEl = overlay.querySelector('#eula-accept-error');
    const cb2 = overlay.querySelector('#eula-close-btn');
    if (cb2) cb2.addEventListener('click', close);

    nameInput.addEventListener('input', () => {
      agreeBtn.disabled = nameInput.value.trim().length < 2;
    });
    nameInput.focus();

    agreeBtn.addEventListener('click', async () => {
      const typed = nameInput.value.trim();
      if (typed.length < 2) return;
      agreeBtn.disabled = true;
      errEl.textContent = '';
      try {
        const result = await postAccept(typed, localeServed);
        if (typeof opts.onAgree === 'function') {
          await opts.onAgree(result);
        }
        close();
      } catch (err) {
        errEl.textContent = err.message ||
          t('legal.eula.acceptError', 'Could not record your acceptance. Please try again.');
        agreeBtn.disabled = nameInput.value.trim().length < 2;
      }
    });
  }

  // ─── attach (mirror alert-explainer.js) ───
  function attach() {
    if (!window.Panoptica) window.Panoptica = {};
    window.Panoptica.EulaModal = { open, close };
  }
  attach();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  }
})();
