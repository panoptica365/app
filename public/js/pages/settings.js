/**
 * Panoptica365 — Settings Page
 * Cards: SMTP, Notifications, Anthropic API Key, Access Control (Entra groups).
 */
(function () {
  'use strict';

  function init() {
    // Card → sub-view navigation
    document.getElementById('card-smtp')?.addEventListener('click', () => showView('smtp'));
    document.getElementById('card-notifications')?.addEventListener('click', () => showView('notif'));
    document.getElementById('card-anthropic')?.addEventListener('click', () => showView('anthropic'));
    document.getElementById('card-briefing')?.addEventListener('click', () => showView('briefing'));
    document.getElementById('card-message-center')?.addEventListener('click', () => showView('message_center'));
    document.getElementById('card-access')?.addEventListener('click', () => showView('access'));
    document.getElementById('card-branding')?.addEventListener('click', () => showView('branding'));
    document.getElementById('card-licensing')?.addEventListener('click', () => showView('licensing'));
    document.getElementById('card-diagnostics')?.addEventListener('click', () => showView('diagnostics'));
    document.getElementById('card-disk')?.addEventListener('click', () => showView('disk'));
    document.getElementById('card-psa')?.addEventListener('click', () => showView('psa'));
    document.getElementById('card-retention')?.addEventListener('click', () => showView('retention'));
    document.getElementById('card-release')?.addEventListener('click', () => showView('release'));
    document.getElementById('card-tiers')?.addEventListener('click', () => showView('tiers'));
    document.getElementById('card-reps')?.addEventListener('click', () => showView('reps'));
    // License Agreement — opens the shared EULA modal in read-only mode
    // (provenance + acceptance history). No sub-view.
    document.getElementById('card-eula')?.addEventListener('click', () => {
      const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang && window.PanopticaI18n.currentLang()) || 'en';
      if (window.Panoptica && window.Panoptica.EulaModal) {
        window.Panoptica.EulaModal.open({ mode: 'readonly', locale: lang });
      }
    });

    // Back buttons
    document.getElementById('smtp-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('notif-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('anthropic-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('briefing-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('message-center-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('access-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('branding-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('licensing-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('licensing-refresh')?.addEventListener('click', refreshLicensing);

    // Diagnostics handlers
    document.getElementById('diagnostics-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('diagnostics-capture')?.addEventListener('click', startDiagnosticsCapture);

    // Disk space handlers
    document.getElementById('disk-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('disk-refresh')?.addEventListener('click', loadDisk);

    // Data retention handlers
    document.getElementById('retention-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('retention-save')?.addEventListener('click', saveRetention);

    // Release Settings handlers (Early/Stable, 2026-07-01)
    document.getElementById('release-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('tiers-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('reps-back')?.addEventListener('click', () => showView('cards'));

    // Organization lists (Service Tiers / Sales Reps) — add entry via button
    // or Enter in the input.
    for (const kind of ['tiers', 'reps']) {
      document.getElementById(`${kind}-add-btn`)?.addEventListener('click', () => addOrgEntry(kind));
      document.getElementById(`${kind}-new-name`)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addOrgEntry(kind); }
      });
    }
    document.getElementById('release-save')?.addEventListener('click', saveReleaseChannel);

    // Daily Summary handlers
    document.getElementById('briefing-save')?.addEventListener('click', saveBriefing);

    // Microsoft Message Feed handlers
    document.getElementById('message-center-save')?.addEventListener('click', saveMessageCenter);

    // PSA Integration handlers (Feature 8.3)
    document.getElementById('psa-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('psa-provider')?.addEventListener('change', onPsaProviderChange);
    document.getElementById('psa-test-btn')?.addEventListener('click', testPsaConnection);
    document.getElementById('psa-save-config')?.addEventListener('click', savePsaConfig);
    document.getElementById('psa-suggest-btn')?.addEventListener('click', suggestPsaMatches);
    document.getElementById('psa-save-mapping')?.addEventListener('click', savePsaMapping);
    document.getElementById('psa-default-company-search')?.addEventListener('input', debouncePsaCompanySearch);

    // SMTP handlers (unchanged)
    document.getElementById('smtp-save')?.addEventListener('click', saveSmtp);
    document.getElementById('smtp-test')?.addEventListener('click', testSmtp);
    document.getElementById('smtp-pass-toggle')?.addEventListener('click', togglePassVisibility);

    // Notification handlers (unchanged)
    document.getElementById('notif-save')?.addEventListener('click', saveNotifications);

    // Anthropic handlers
    document.getElementById('anthropic-test')?.addEventListener('click', testAnthropicKey);
    document.getElementById('anthropic-save')?.addEventListener('click', saveAnthropicKey);
    document.getElementById('anthropic-reveal')?.addEventListener('click', toggleAnthropicReveal);

    // Branding handlers
    document.getElementById('branding-save')?.addEventListener('click', saveBranding);
    document.getElementById('branding-logo-file')?.addEventListener('change', onBrandingLogoPicked);
    document.getElementById('branding-logo-remove')?.addEventListener('click', removeBrandingLogo);

    // Access Control handlers
    document.getElementById('access-save')?.addEventListener('click', saveAccessControl);
    document.querySelectorAll('.access-verify-btn').forEach(btn => {
      btn.addEventListener('click', () => verifyAccessField(btn.dataset.field));
    });
    ['admin', 'member', 'viewer'].forEach(field => {
      const input = document.getElementById(`access-${field}-id`);
      input?.addEventListener('blur', () => {
        if (input.value.trim() && input.value.trim() !== input.dataset.lastVerified) {
          verifyAccessField(field);
        }
      });
      input?.addEventListener('input', () => {
        // Clear previous result styling when the user types
        input.classList.remove('resolved', 'invalid');
        const resultEl = document.getElementById(`access-${field}-result`);
        if (resultEl) { resultEl.textContent = ''; resultEl.className = 'access-result'; }
      });
    });
  }

  // ─── Licensing (v0.1.39) — read-only view of seat usage ───
  function fmtNum(n) {
    return (typeof n === 'number' && isFinite(n)) ? n.toLocaleString() : '—';
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang && window.PanopticaI18n.currentLang()) || 'en';
    const loc = lang === 'fr' ? 'fr-CA' : (lang === 'es' ? 'es' : 'en-CA');
    try { return new Date(iso).toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (e) { return iso; }
  }

  function renderLicensing(data) {
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText('licensing-max-seats', fmtNum(data.max_seats));
    setText('licensing-current-seats',
      (data.current_seats_reported === null || data.current_seats_reported === undefined)
        ? window.t('settings.licensing.seats_pending')
        : fmtNum(data.current_seats_reported));
    setText('licensing-msp', data.msp_name || '—');
    setText('licensing-tier', data.tier || '—');
    setText('licensing-expires', fmtDate(data.expires_at));

    // Over-seat note: only when we have both numbers and current exceeds max.
    const note = document.getElementById('licensing-seats-note');
    if (note) {
      const max = data.max_seats, cur = data.current_seats_reported;
      if (typeof max === 'number' && typeof cur === 'number' && cur > max) {
        note.textContent = window.t('settings.licensing.over_seats', { over: (cur - max) });
        note.style.color = 'var(--p-warn)';
        note.style.display = '';
      } else if (cur === null || cur === undefined) {
        note.textContent = window.t('settings.licensing.seats_pending_note');
        note.style.color = '';
        note.style.display = '';
      } else {
        note.style.display = 'none';
      }
    }
  }

  async function loadLicensing() {
    const loading = document.getElementById('licensing-loading');
    const body    = document.getElementById('licensing-body');
    const errEl   = document.getElementById('licensing-error');
    if (loading) loading.style.display = '';
    if (body) body.style.display = 'none';
    if (errEl) errEl.style.display = 'none';
    try {
      const data = await Panoptica.api('/api/license/status');
      renderLicensing(data);
      if (loading) loading.style.display = 'none';
      if (body) body.style.display = '';
    } catch (err) {
      if (loading) loading.style.display = 'none';
      if (errEl) {
        errEl.textContent = (err && err.message) || window.t('settings.licensing.load_failed');
        errEl.style.display = '';
      }
    }
  }

  async function refreshLicensing() {
    const btn = document.getElementById('licensing-refresh');
    const status = document.getElementById('licensing-status');
    if (btn) btn.setAttribute('disabled', 'disabled');
    if (status) status.textContent = window.t('settings.licensing.refreshing');
    try {
      await Panoptica.api('/api/license/refresh-now', { method: 'POST' });
      await loadLicensing();
      if (status) status.textContent = window.t('settings.licensing.refresh_done');
    } catch (err) {
      if (status) status.textContent = (err && err.message) || window.t('settings.licensing.refresh_failed');
    } finally {
      if (btn) btn.removeAttribute('disabled');
    }
  }

  // ─── Diagnostics (Part 3, 2026-06-03) — capture + download support bundle ───
  let diagPollTimer = null;
  let diagTickTimer = null;   // 1s elapsed-time ticker (liveness between 2s polls)
  let diagLastStatus = null;  // last status the ticker re-renders the elapsed onto

  function fmtDateTime(iso) {
    if (!iso) return '—';
    const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang && window.PanopticaI18n.currentLang()) || 'en';
    const loc = lang === 'fr' ? 'fr-CA' : (lang === 'es' ? 'es' : 'en-CA');
    try { return new Date(iso).toLocaleString(loc, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return iso; }
  }

  function fmtBytes(n) {
    if (typeof n !== 'number' || !isFinite(n) || n <= 0) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function diagPhaseLabel(s) {
    switch (s.phase) {
      case 'queued':     return window.t('settings.diagnostics.phase_queued');
      case 'collecting': return window.t('settings.diagnostics.phase_collecting', { step: s.step || 0, total: s.total || 0 });
      case 'redacting':  return window.t('settings.diagnostics.phase_redacting');
      case 'zipping':    return window.t('settings.diagnostics.phase_zipping');
      case 'done':       return s.partial ? window.t('settings.diagnostics.phase_done_partial') : window.t('settings.diagnostics.phase_done');
      case 'error':      return window.t('settings.diagnostics.phase_error');
      default:           return '';
    }
  }

  // Whole seconds since the capture started — drives the live elapsed counter so
  // even a single slow step visibly "ticks" rather than looking frozen.
  function diagElapsedSecs(s) {
    if (!s || !s.started_at) return null;
    const t = Date.parse(s.started_at);
    if (!isFinite(t)) return null;
    return Math.max(0, Math.round((Date.now() - t) / 1000));
  }

  function diagProgressText(s) {
    let txt = diagPhaseLabel(s);
    if (s && s.running) {
      const secs = diagElapsedSecs(s);
      if (secs !== null) txt += ` · ${secs} s`;
    }
    return txt;
  }

  function startDiagTick() {
    if (diagTickTimer) return;
    diagTickTimer = setInterval(() => {
      const progress = document.getElementById('diagnostics-progress');
      if (progress && diagLastStatus && diagLastStatus.running) {
        progress.textContent = diagProgressText(diagLastStatus);
      }
    }, 1000);
  }

  function stopDiagTick() {
    if (diagTickTimer) { clearInterval(diagTickTimer); diagTickTimer = null; }
  }

  function renderDiagnosticsBundles(bundles) {
    const empty = document.getElementById('diagnostics-bundles-empty');
    const table = document.getElementById('diagnostics-bundles-table');
    const body  = document.getElementById('diagnostics-bundles-body');
    if (!body) return;
    if (bundles === undefined) return; // status update without a fresh list — leave as-is
    if (!bundles || !bundles.length) {
      if (empty) empty.style.display = '';
      if (table) table.style.display = 'none';
      body.innerHTML = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (table) table.style.display = '';
    const dlLabel = window.t('settings.diagnostics.download_btn');
    body.innerHTML = bundles.map(b => `
      <tr>
        <td>${escHtml(fmtDateTime(b.created_at))}</td>
        <td>${escHtml(fmtBytes(b.size_bytes))}</td>
        <td style="text-align:right;">
          <a class="btn-secondary" href="/api/diagnostics/download/${encodeURIComponent(b.id)}" download>${escHtml(dlLabel)}</a>
        </td>
      </tr>`).join('');
  }

  function applyDiagnosticsStatus(s) {
    const btn = document.getElementById('diagnostics-capture');
    const progress = document.getElementById('diagnostics-progress');
    const errEl = document.getElementById('diagnostics-error');

    if (btn) {
      if (s.running) btn.setAttribute('disabled', 'disabled');
      else btn.removeAttribute('disabled');
    }
    diagLastStatus = s;
    if (s.running) startDiagTick(); else stopDiagTick();
    if (progress) progress.textContent = s.running || s.phase === 'done' || s.phase === 'error' ? diagProgressText(s) : '';
    if (errEl) {
      if (s.phase === 'error' && s.error) {
        errEl.textContent = window.t('settings.diagnostics.capture_failed', { message: s.error });
        errEl.style.display = '';
      } else {
        errEl.style.display = 'none';
      }
    }
    renderDiagnosticsBundles(s.bundles);
  }

  function stopDiagnosticsPoll() {
    if (diagPollTimer) { clearInterval(diagPollTimer); diagPollTimer = null; }
    stopDiagTick();
  }

  async function pollDiagnosticsOnce() {
    try {
      const s = await Panoptica.api('/api/diagnostics/status');
      applyDiagnosticsStatus(s);
      if (!s.running) {
        stopDiagnosticsPoll();
        if (s.phase === 'done' && !s.partial) {
          Panoptica.showToast(window.t('settings.diagnostics.toast_ready'), 'success');
        } else if (s.phase === 'done' && s.partial) {
          Panoptica.showToast(window.t('settings.diagnostics.toast_partial'), 'warning');
        }
      }
    } catch (err) {
      stopDiagnosticsPoll();
    }
  }

  async function loadDiagnostics() {
    try {
      const s = await Panoptica.api('/api/diagnostics/status');
      applyDiagnosticsStatus(s);
      if (s.running) startDiagnosticsPoll();
    } catch (err) {
      const errEl = document.getElementById('diagnostics-error');
      if (errEl) { errEl.textContent = (err && err.message) || window.t('settings.diagnostics.load_failed'); errEl.style.display = ''; }
    }
  }

  function startDiagnosticsPoll() {
    stopDiagnosticsPoll();
    diagPollTimer = setInterval(pollDiagnosticsOnce, 2000);
  }

  async function startDiagnosticsCapture() {
    const errEl = document.getElementById('diagnostics-error');
    if (errEl) errEl.style.display = 'none';
    const btn = document.getElementById('diagnostics-capture');
    if (btn) btn.setAttribute('disabled', 'disabled');
    try {
      await Panoptica.api('/api/diagnostics/capture', { method: 'POST' });
      applyDiagnosticsStatus({ running: true, phase: 'queued', bundles: undefined });
      startDiagnosticsPoll();
    } catch (err) {
      if (btn) btn.removeAttribute('disabled');
      if (errEl) {
        errEl.textContent = (err && err.message) || window.t('settings.diagnostics.capture_failed', { message: '' });
        errEl.style.display = '';
      }
    }
  }

  // ─── Disk space (2026-06-04) — storage usage + threshold note ───
  function diskGb(bytes) {
    if (typeof bytes !== 'number' || !isFinite(bytes)) return '—';
    return (bytes / (1024 ** 3)).toFixed(1) + ' GB';
  }

  function renderDisk(check) {
    const d = check.detail || {};
    const usedPct = typeof d.used_pct === 'number' ? d.used_pct : null;
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

    const usedBytes = (typeof d.total_bytes === 'number' && typeof d.free_bytes === 'number')
      ? d.total_bytes - d.free_bytes : null;
    setText('disk-used', usedPct != null ? `${diskGb(usedBytes)} (${usedPct}%)` : '—');
    setText('disk-free', diskGb(d.free_bytes));
    setText('disk-total', diskGb(d.total_bytes));

    // Usage bar width + colour by state.
    const fill = document.getElementById('disk-usage-fill');
    if (fill) {
      fill.style.width = (usedPct != null ? Math.min(100, usedPct) : 0) + '%';
      fill.style.background = check.state === 'crit' ? 'var(--p-danger,#d9534f)'
        : check.state === 'warn' ? 'var(--p-warn,#e0a800)'
        : 'var(--p-ok,#2e9e5b)';
    }

    // Threshold note — reuse the check's own localized summary (carries numbers).
    const note = document.getElementById('disk-note');
    if (note) {
      note.textContent = check.summary || '';
      note.style.color = check.state === 'crit' ? 'var(--p-danger)'
        : check.state === 'warn' ? 'var(--p-warn)' : 'var(--p-text-muted)';
    }
  }

  async function loadDisk() {
    const loading = document.getElementById('disk-loading');
    const body = document.getElementById('disk-body');
    const errEl = document.getElementById('disk-error');
    const status = document.getElementById('disk-status');
    if (status) status.textContent = '';
    if (loading) loading.style.display = '';
    if (body) body.style.display = 'none';
    if (errEl) errEl.style.display = 'none';
    try {
      const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang && window.PanopticaI18n.currentLang()) || 'en';
      const check = await Panoptica.api('/api/health/disk?lang=' + lang);
      renderDisk(check);
      if (loading) loading.style.display = 'none';
      if (body) body.style.display = '';
    } catch (err) {
      if (loading) loading.style.display = 'none';
      if (errEl) {
        errEl.textContent = (err && err.message) || window.t('settings.disk.load_failed');
        errEl.style.display = '';
      }
    }
  }

  // ─── Data retention (editable, Reliability P0 2026-06-12) ───
  // Rows render from GET /api/settings/retention (values + per-field bounds);
  // names and impact explanations are localized. Saving PUTs only the fields,
  // which the server validates again, persists to .env, and live-reloads.
  let retentionWindows = [];

  function renderRetentionRows() {
    const rowsEl = document.getElementById('retention-rows');
    if (!rowsEl) return;
    rowsEl.innerHTML = retentionWindows.map(w => {
      const name = window.t('settings.retention.tables.' + w.table);
      const hint = window.t('settings.retention.hints.' + w.table);
      const recommended = window.t('settings.retention.recommended', { days: w.default });
      const foreverNote = w.allow_zero ? ' ' + window.t('settings.retention.forever_note') : '';
      return `<div class="form-group" style="margin-bottom:18px;">
        <label>${esc(name)}</label>
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="number" id="ret-${esc(w.table)}" value="${esc(w.days)}"
                 min="${w.allow_zero ? 0 : w.min}" max="${w.max}" step="1" style="width:110px;">
          <span>${esc(window.t('settings.retention.days_unit'))}</span>
          <span class="form-hint" style="margin:0;">${esc(recommended)}${esc(foreverNote)}</span>
        </div>
        <div class="form-hint" style="margin-top:4px;">${esc(hint)}</div>
      </div>`;
    }).join('');
  }

  async function loadRetention() {
    const loading = document.getElementById('retention-loading');
    const body = document.getElementById('retention-body');
    const errEl = document.getElementById('retention-error');
    const statusEl = document.getElementById('retention-status');
    if (statusEl) statusEl.textContent = '';
    if (loading) loading.style.display = '';
    if (body) body.style.display = 'none';
    if (errEl) errEl.style.display = 'none';
    try {
      const data = await Panoptica.api('/api/settings/retention');
      retentionWindows = data.windows || [];
      renderRetentionRows();
      if (loading) loading.style.display = 'none';
      if (body) body.style.display = '';
    } catch (err) {
      if (loading) loading.style.display = 'none';
      if (errEl) {
        errEl.textContent = (err && err.message) || window.t('settings.retention.load_failed');
        errEl.style.display = '';
      }
    }
  }

  async function saveRetention() {
    const statusEl = document.getElementById('retention-status');
    const windows = {};
    // Client-side pass mirrors the server bounds so the operator gets a named,
    // localized error instead of a 400; the server re-validates regardless.
    for (const w of retentionWindows) {
      const input = document.getElementById('ret-' + w.table);
      if (!input) continue;
      const v = Number(input.value);
      const valid = Number.isInteger(v)
        && ((w.allow_zero && v === 0) || (v >= w.min && v <= w.max));
      if (!valid) {
        const msg = window.t('settings.retention.invalid_value', {
          name: window.t('settings.retention.tables.' + w.table),
          min: w.min, max: w.max,
        });
        if (statusEl) { statusEl.textContent = msg; statusEl.style.color = '#e74c3c'; }
        Panoptica.showToast(msg, 'error');
        input.focus();
        return;
      }
      windows[w.table] = v;
    }
    if (statusEl) {
      statusEl.textContent = window.t('settings.status.saving');
      statusEl.style.color = 'var(--p-text-muted)';
    }
    try {
      await Panoptica.api('/api/settings/retention', {
        method: 'PUT',
        body: JSON.stringify({ windows }),
      });
      if (statusEl) { statusEl.textContent = window.t('settings.status.saved'); statusEl.style.color = '#27ae60'; }
      Panoptica.showToast(window.t('settings.retention.toast_saved'), 'success');
      loadRetention();
    } catch (err) {
      if (statusEl) { statusEl.textContent = window.t('settings.status.error'); statusEl.style.color = '#e74c3c'; }
      Panoptica.showToast(window.t('settings.toast_save_failed', { message: err.message }), 'error');
    }
  }

  // ─── Release Settings (Early/Stable, 2026-07-01) ───
  async function loadReleaseChannel() {
    const loading = document.getElementById('release-loading');
    const body = document.getElementById('release-body');
    const errEl = document.getElementById('release-error');
    const statusEl = document.getElementById('release-status');
    if (statusEl) statusEl.textContent = '';
    if (loading) loading.style.display = '';
    if (body) body.style.display = 'none';
    if (errEl) errEl.style.display = 'none';
    try {
      const data = await Panoptica.api('/api/settings/release-channel');
      const channel = data.channel === 'early' ? 'early' : 'stable';
      const radio = document.querySelector(`input[name="release-channel"][value="${channel}"]`);
      if (radio) radio.checked = true;
      if (loading) loading.style.display = 'none';
      if (body) body.style.display = '';
    } catch (err) {
      if (loading) loading.style.display = 'none';
      if (errEl) {
        errEl.textContent = (err && err.message) || window.t('settings.release.load_failed');
        errEl.style.display = '';
      }
    }
  }

  async function saveReleaseChannel() {
    const statusEl = document.getElementById('release-status');
    const picked = document.querySelector('input[name="release-channel"]:checked');
    if (!picked) return;
    statusEl.textContent = window.t('settings.status.saving');
    statusEl.style.color = 'var(--p-text-muted)';
    try {
      await Panoptica.api('/api/settings/release-channel', {
        method: 'PUT',
        body: JSON.stringify({ channel: picked.value }),
      });
      statusEl.textContent = window.t('settings.status.saved');
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.release.toast_saved'), 'success');
    } catch (err) {
      statusEl.textContent = window.t('settings.status.error');
      statusEl.style.color = '#e74c3c';
      Panoptica.showToast(window.t('settings.toast_save_failed', { message: err.message }), 'error');
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function destroy() { stopDiagnosticsPoll(); }

  function showView(view) {
    const blocks = {
      cards:     document.getElementById('settings-cards'),
      smtp:      document.getElementById('settings-smtp-view'),
      notif:     document.getElementById('settings-notif-view'),
      anthropic: document.getElementById('settings-anthropic-view'),
      briefing:  document.getElementById('settings-briefing-view'),
      message_center: document.getElementById('settings-message-center-view'),
      access:    document.getElementById('settings-access-view'),
      branding:  document.getElementById('settings-branding-view'),
      licensing: document.getElementById('settings-licensing-view'),
      diagnostics: document.getElementById('settings-diagnostics-view'),
      disk: document.getElementById('settings-disk-view'),
      psa: document.getElementById('settings-psa-view'),
      retention: document.getElementById('settings-retention-view'),
      release: document.getElementById('settings-release-view'),
      tiers: document.getElementById('settings-tiers-view'),
      reps: document.getElementById('settings-reps-view'),
    };
    Object.entries(blocks).forEach(([k, el]) => {
      if (el) el.style.display = (k === view) ? '' : 'none';
    });
    // Leaving the diagnostics view stops its progress poll.
    if (view !== 'diagnostics') stopDiagnosticsPoll();
    if (view === 'smtp')      loadSmtp();
    if (view === 'notif')     loadNotifications();
    if (view === 'anthropic') loadAnthropicKey();
    if (view === 'briefing')  loadBriefing();
    if (view === 'message_center') loadMessageCenter();
    if (view === 'access')    loadAccessControl();
    if (view === 'branding')  loadBranding();
    if (view === 'licensing') loadLicensing();
    if (view === 'diagnostics') loadDiagnostics();
    if (view === 'disk') loadDisk();
    if (view === 'psa') loadPsa();
    if (view === 'retention') loadRetention();
    if (view === 'release') loadReleaseChannel();
    if (view === 'tiers') loadOrgList('tiers');
    if (view === 'reps') loadOrgList('reps');
  }

  // ─── Organization lists: Service Tiers & Sales Reps (Tenant Groups Phase 1) ───
  // Two managed lookup lists behind /api/org. Shared renderer — the two
  // widgets are identical except for the endpoint slug and i18n keys.

  const ORG_KINDS = {
    tiers: { slug: 'service-tiers', maxLen: 100 },
    reps: { slug: 'sales-reps', maxLen: 150 },
  };
  const orgState = {
    tiers: { rows: [], editingId: null },
    reps: { rows: [], editingId: null },
  };

  // Panoptica.api() throws away structured error bodies; the delete guard's
  // 409 carries the blocking tenant/group names we must show, so org
  // mutations use this raw wrapper instead.
  async function orgApiRaw(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...options,
    });
    let body = null;
    try { body = await res.json(); } catch (_) { /* empty body */ }
    return { ok: res.ok, status: res.status, body: body || {} };
  }

  async function loadOrgList(kind) {
    const cfg = ORG_KINDS[kind];
    const listEl = document.getElementById(`${kind}-list`);
    if (!listEl) return;
    listEl.innerHTML = `<div class="form-hint">${escHtml(window.t('settings.org.loading'))}</div>`;
    try {
      const rows = await Panoptica.api(`/api/org/${cfg.slug}`);
      orgState[kind].rows = Array.isArray(rows) ? rows : [];
      orgState[kind].editingId = null;
      renderOrgList(kind);
    } catch (err) {
      listEl.innerHTML = `<div class="form-hint" style="color:var(--p-danger);">${escHtml(window.t('settings.org.load_failed', { message: err.message }))}</div>`;
    }
  }

  function renderOrgList(kind) {
    const st = orgState[kind];
    const cfg = ORG_KINDS[kind];
    const listEl = document.getElementById(`${kind}-list`);
    if (!listEl) return;
    if (!st.rows.length) {
      listEl.innerHTML = `<div class="form-hint">${escHtml(window.t('settings.org.empty'))}</div>`;
      return;
    }
    listEl.innerHTML = st.rows.map(r => {
      const editing = st.editingId === r.id;
      const usage = window.t('settings.org.in_use', { tenants: r.tenant_count, groups: r.group_rule_count });
      const nameCell = editing
        ? `<input type="text" id="${kind}-edit-name" value="${escHtml(r.name)}" maxlength="${cfg.maxLen}" style="flex:1;">`
        : `<span style="flex:1;${r.active ? '' : ' opacity:0.55;'}">${escHtml(r.name)}${r.active ? '' : ` <em style="font-size:0.75rem; color:var(--p-text-muted);">${escHtml(window.t('settings.org.inactive_badge'))}</em>`}</span>`;
      const btns = editing
        ? `<button class="btn-primary" data-org-act="rename-save" data-id="${r.id}">${escHtml(window.t('modals.save'))}</button>
           <button class="btn-secondary" data-org-act="rename-cancel" data-id="${r.id}">${escHtml(window.t('modals.cancel'))}</button>`
        : `<button class="btn-secondary" data-org-act="rename" data-id="${r.id}">${escHtml(window.t('settings.org.rename_btn'))}</button>
           <button class="btn-secondary" data-org-act="toggle" data-id="${r.id}">${escHtml(window.t(r.active ? 'settings.org.deactivate_btn' : 'settings.org.reactivate_btn'))}</button>
           <button class="btn-danger" data-org-act="delete" data-id="${r.id}">${escHtml(window.t('settings.org.delete_btn'))}</button>`;
      return `<div style="display:flex; align-items:center; gap:10px; padding:9px 4px; border-bottom:1px solid var(--p-border-subtle);">
        ${nameCell}
        <span style="font-size:0.75rem; color:var(--p-text-muted); white-space:nowrap;">${escHtml(usage)}</span>
        ${btns}
      </div>`;
    }).join('');
    listEl.querySelectorAll('[data-org-act]').forEach(btn => {
      btn.addEventListener('click', () => onOrgAction(kind, btn.dataset.orgAct, parseInt(btn.dataset.id, 10)));
    });
  }

  async function addOrgEntry(kind) {
    const cfg = ORG_KINDS[kind];
    const input = document.getElementById(`${kind}-new-name`);
    const name = input?.value?.trim();
    if (!name) return;
    const r = await orgApiRaw(`/api/org/${cfg.slug}`, { method: 'POST', body: JSON.stringify({ name }) });
    if (r.ok) {
      if (input) input.value = '';
      Panoptica.showToast(window.t('settings.org.toast_added', { name }), 'success');
      await loadOrgList(kind);
    } else if (r.status === 409) {
      Panoptica.showToast(window.t('settings.org.toast_duplicate', { name }), 'error');
    } else {
      Panoptica.showToast(window.t('settings.toast_save_failed', { message: r.body.error || `HTTP ${r.status}` }), 'error');
    }
  }

  async function onOrgAction(kind, act, id) {
    const cfg = ORG_KINDS[kind];
    const st = orgState[kind];
    const row = st.rows.find(x => x.id === id);
    if (!row) return;

    if (act === 'rename') { st.editingId = id; renderOrgList(kind); document.getElementById(`${kind}-edit-name`)?.focus(); return; }
    if (act === 'rename-cancel') { st.editingId = null; renderOrgList(kind); return; }

    if (act === 'rename-save') {
      const name = document.getElementById(`${kind}-edit-name`)?.value?.trim();
      if (!name) return;
      if (name === row.name) { st.editingId = null; renderOrgList(kind); return; }
      const r = await orgApiRaw(`/api/org/${cfg.slug}/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      if (r.ok) {
        Panoptica.showToast(window.t('settings.org.toast_renamed', { from: row.name, to: name }), 'success');
        await loadOrgList(kind);
      } else if (r.status === 409) {
        Panoptica.showToast(window.t('settings.org.toast_duplicate', { name }), 'error');
      } else {
        Panoptica.showToast(window.t('settings.toast_save_failed', { message: r.body.error || `HTTP ${r.status}` }), 'error');
      }
      return;
    }

    if (act === 'toggle') {
      const r = await orgApiRaw(`/api/org/${cfg.slug}/${id}`, { method: 'PATCH', body: JSON.stringify({ active: !row.active }) });
      if (r.ok) {
        Panoptica.showToast(window.t(row.active ? 'settings.org.toast_deactivated' : 'settings.org.toast_reactivated', { name: row.name }), 'success');
        await loadOrgList(kind);
      } else {
        Panoptica.showToast(window.t('settings.toast_save_failed', { message: r.body.error || `HTTP ${r.status}` }), 'error');
      }
      return;
    }

    if (act === 'delete') {
      const proceed = await Panoptica.confirmModal(window.t('settings.org.confirm_delete', { name: row.name }), { danger: true });
      if (!proceed) return;
      const r = await orgApiRaw(`/api/org/${cfg.slug}/${id}`, { method: 'DELETE' });
      if (r.ok) {
        Panoptica.showToast(window.t('settings.org.toast_deleted', { name: row.name }), 'success');
        await loadOrgList(kind);
      } else if (r.status === 409 && r.body.error === 'in_use') {
        // Delete guard — show WHO is blocking so the operator knows what to
        // reassign, and point at deactivate as the graceful path.
        const tenants = Array.isArray(r.body.blocking_tenants) ? r.body.blocking_tenants : [];
        const groups = Array.isArray(r.body.blocking_groups) ? r.body.blocking_groups : [];
        const listHtml = (title, items) => items.length
          ? `<div style="margin-top:10px;"><b>${escHtml(title)}</b><ul style="margin:6px 0 0 18px; padding:0;">${items.map(n => `<li>${escHtml(n)}</li>`).join('')}</ul></div>`
          : '';
        Panoptica.openModal(
          window.t('settings.org.blocked_title'),
          `<p style="margin:0;">${escHtml(window.t('settings.org.blocked_intro', { name: row.name }))}</p>` +
          listHtml(window.t('settings.org.blocked_tenants'), tenants) +
          listHtml(window.t('settings.org.blocked_groups'), groups) +
          `<p style="margin:12px 0 0; color:var(--p-text-muted); font-size:0.85rem;">${escHtml(window.t('settings.org.blocked_hint'))}</p>`,
          `<button class="btn-secondary" onclick="Panoptica.closeModal()">${escHtml(window.t('modals.close'))}</button>`
        );
      } else {
        Panoptica.showToast(window.t('settings.toast_save_failed', { message: r.body.error || `HTTP ${r.status}` }), 'error');
      }
    }
  }

  // ─── Microsoft Message Feed (Feature 8.8) ───

  async function loadMessageCenter() {
    const sel = document.getElementById('mc-source-tenant');
    if (!sel) return;
    try {
      // Populate the picker from the operator's tenants, then select the
      // currently-configured source tenant (or None). The first <option>
      // (None) is defined in the partial and preserved here.
      const [tenants, current] = await Promise.all([
        Panoptica.api('/api/tenants'),
        Panoptica.api('/api/settings/message-center'),
      ]);
      const list = Array.isArray(tenants) ? tenants : (tenants.tenants || []);
      // Rebuild options: keep the None option, append one per tenant.
      const noneLabel = window.t('settings.message_center.option_none');
      sel.innerHTML = `<option value="">${noneLabel}</option>` +
        list
          .slice()
          .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
          .map(t => `<option value="${t.tenant_id}">${escHtml(t.display_name)}</option>`)
          .join('');
      sel.value = current.source_tenant || '';
    } catch (err) {
      Panoptica.showToast(window.t('settings.message_center.toast_load_failed', { message: err.message }), 'error');
    }
  }

  async function saveMessageCenter() {
    const statusEl = document.getElementById('message-center-status');
    const sel = document.getElementById('mc-source-tenant');
    if (!sel) return;
    statusEl.textContent = window.t('settings.status.saving');
    statusEl.style.color = 'var(--p-text-muted)';
    try {
      await Panoptica.api('/api/settings/message-center', {
        method: 'PUT',
        body: JSON.stringify({ source_tenant: sel.value || null }),
      });
      statusEl.textContent = window.t('settings.status.saved');
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.message_center.toast_saved'), 'success');
    } catch (err) {
      statusEl.textContent = window.t('settings.status.error');
      statusEl.style.color = '#e74c3c';
      Panoptica.showToast(window.t('settings.toast_save_failed', { message: err.message }), 'error');
    }
  }

  // Minimal HTML escape for option labels (display names are operator-controlled
  // but rendered as HTML here).
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }

  // ─── Daily Summary ───

  async function loadBriefing() {
    try {
      const data = await Panoptica.api('/api/settings/briefing');
      const sel = document.getElementById('briefing-min-severity');
      if (sel) sel.value = data.min_severity || 'info';
    } catch (err) {
      Panoptica.showToast(window.t('settings.toast_briefing_load_failed', { message: err.message }), 'error');
    }
  }

  async function saveBriefing() {
    const statusEl = document.getElementById('briefing-status');
    const sel = document.getElementById('briefing-min-severity');
    if (!sel) return;
    statusEl.textContent = window.t('settings.status.saving');
    statusEl.style.color = 'var(--p-text-muted)';
    try {
      await Panoptica.api('/api/settings/briefing', {
        method: 'PUT',
        body: JSON.stringify({ min_severity: sel.value }),
      });
      statusEl.textContent = window.t('settings.status.saved');
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.toast_briefing_saved'), 'success');
    } catch (err) {
      statusEl.textContent = window.t('settings.status.error');
      statusEl.style.color = '#e74c3c';
      Panoptica.showToast(window.t('settings.toast_save_failed', { message: err.message }), 'error');
    }
  }

  // ─── SMTP ───

  async function loadSmtp() {
    try {
      const data = await Panoptica.api('/api/settings/smtp');
      document.getElementById('smtp-host').value = data.host || '';
      document.getElementById('smtp-port').value = data.port || '';
      document.getElementById('smtp-user').value = data.user || '';
      document.getElementById('smtp-pass').value = '';
      document.getElementById('smtp-pass').placeholder = data.pass_set ? window.t('settings.smtp.pass_placeholder_unchanged') : window.t('settings.smtp.pass_placeholder_enter');
      document.getElementById('smtp-from').value = data.from || '';
    } catch (err) {
      Panoptica.showToast(window.t('settings.toast_smtp_load_failed', { message: err.message }), 'error');
    }
  }

  async function saveSmtp() {
    const statusEl = document.getElementById('smtp-status');
    statusEl.textContent = window.t('settings.status.saving');
    statusEl.style.color = 'var(--p-text-muted)';
    const payload = {
      host: document.getElementById('smtp-host').value.trim(),
      port: parseInt(document.getElementById('smtp-port').value, 10) || 2525,
      user: document.getElementById('smtp-user').value.trim(),
      from: document.getElementById('smtp-from').value.trim(),
    };
    const pass = document.getElementById('smtp-pass').value;
    if (pass) payload.pass = pass;
    try {
      await Panoptica.api('/api/settings/smtp', { method: 'PUT', body: JSON.stringify(payload) });
      statusEl.textContent = window.t('settings.status.saved');
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.toast_smtp_saved'), 'success');
      setTimeout(() => loadSmtp(), 500);
    } catch (err) {
      statusEl.textContent = window.t('settings.status.error');
      statusEl.style.color = '#e74c3c';
      Panoptica.showToast(window.t('settings.toast_save_failed', { message: err.message }), 'error');
    }
  }

  async function testSmtp() {
    const statusEl = document.getElementById('smtp-status');
    const testTo = (document.getElementById('smtp-test-to')?.value || '').trim();
    if (!testTo) {
      statusEl.textContent = window.t('settings.smtp.test_recipient_required');
      statusEl.style.color = '#e67e22';
      return;
    }
    statusEl.textContent = window.t('settings.smtp.status_sending_test');
    statusEl.style.color = 'var(--p-text-muted)';
    try {
      const result = await Panoptica.api('/api/settings/smtp/test', {
        method: 'POST',
        body: JSON.stringify({ to: testTo }),
      });
      statusEl.textContent = window.t('settings.smtp.status_test_sent_to', { recipient: result.sent_to });
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.toast_test_email_sent', { recipient: result.sent_to }), 'success');
    } catch (err) {
      statusEl.textContent = window.t('settings.smtp.status_test_failed');
      statusEl.style.color = '#e74c3c';
      Panoptica.showToast(window.t('settings.toast_smtp_test_failed', { message: err.message }), 'error');
    }
  }

  function togglePassVisibility() {
    const input = document.getElementById('smtp-pass');
    const btn = document.getElementById('smtp-pass-toggle');
    if (input.type === 'password') { input.type = 'text'; btn.textContent = window.t('settings.btn_hide'); }
    else { input.type = 'password'; btn.textContent = window.t('settings.btn_show'); }
  }

  // ─── Notifications ───

  async function loadNotifications() {
    try {
      const data = await Panoptica.api('/api/settings/notifications');
      document.getElementById('notif-psa-email').value = data.psa_email || '';
      document.getElementById('notif-psa-attribution').value = data.psa_attribution || '';
      document.getElementById('notif-emails').value = data.notify_emails || '';
    } catch (err) {
      Panoptica.showToast(window.t('settings.toast_notif_load_failed', { message: err.message }), 'error');
    }
  }

  async function saveNotifications() {
    const statusEl = document.getElementById('notif-status');
    statusEl.textContent = window.t('settings.status.saving');
    statusEl.style.color = 'var(--p-text-muted)';
    const payload = {
      psa_email: document.getElementById('notif-psa-email').value.trim(),
      psa_attribution: document.getElementById('notif-psa-attribution').value.trim(),
      notify_emails: document.getElementById('notif-emails').value.trim(),
    };
    try {
      await Panoptica.api('/api/settings/notifications', { method: 'PUT', body: JSON.stringify(payload) });
      statusEl.textContent = window.t('settings.status.saved');
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.toast_notif_saved'), 'success');
    } catch (err) {
      statusEl.textContent = window.t('settings.status.error');
      statusEl.style.color = '#e74c3c';
      Panoptica.showToast(window.t('settings.toast_save_failed', { message: err.message }), 'error');
    }
  }

  // ─── Anthropic API Key ───

  async function loadAnthropicKey() {
    const currentEl = document.getElementById('anthropic-current');
    const newEl = document.getElementById('anthropic-new');
    const statusEl = document.getElementById('anthropic-status');
    if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
    if (newEl) newEl.value = '';
    try {
      const data = await Panoptica.api('/api/settings/anthropic-key');
      if (currentEl) currentEl.value = data.key_set ? data.key_preview : window.t('settings.anthropic.no_key_set');
    } catch (err) {
      if (currentEl) currentEl.value = window.t('settings.anthropic.load_failed_inline');
      Panoptica.showToast(window.t('settings.toast_anthropic_load_failed', { message: err.message }), 'error');
    }
  }

  async function testAnthropicKey() {
    const statusEl = document.getElementById('anthropic-status');
    const newKey = (document.getElementById('anthropic-new')?.value || '').trim();
    statusEl.textContent = window.t('settings.anthropic.status_testing');
    statusEl.style.color = 'var(--p-text-muted)';
    try {
      const payload = newKey ? { key: newKey } : {};
      const result = await Panoptica.api('/api/settings/anthropic-key/test', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      statusEl.textContent = window.t('settings.anthropic.test_ok', { model: result.model });
      statusEl.style.color = '#27ae60';
    } catch (err) {
      statusEl.textContent = window.t('settings.anthropic.test_failed', { message: err.message });
      statusEl.style.color = '#e74c3c';
    }
  }

  async function saveAnthropicKey() {
    const newEl = document.getElementById('anthropic-new');
    const statusEl = document.getElementById('anthropic-status');
    const key = (newEl?.value || '').trim();
    if (!key) {
      statusEl.textContent = window.t('settings.anthropic.paste_first');
      statusEl.style.color = '#e67e22';
      return;
    }
    statusEl.textContent = window.t('settings.status.saving');
    statusEl.style.color = 'var(--p-text-muted)';
    try {
      const result = await Panoptica.api('/api/settings/anthropic-key', {
        method: 'PUT',
        body: JSON.stringify({ key }),
      });
      statusEl.textContent = window.t('settings.anthropic.saved_with_preview', { preview: result.key_preview });
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.toast_anthropic_rotated'), 'success');
      setTimeout(loadAnthropicKey, 400);
    } catch (err) {
      statusEl.textContent = window.t('settings.anthropic.test_failed', { message: err.message });
      statusEl.style.color = '#e74c3c';
    }
  }

  function toggleAnthropicReveal() {
    const input = document.getElementById('anthropic-new');
    const btn = document.getElementById('anthropic-reveal');
    if (input.type === 'password') { input.type = 'text'; btn.textContent = window.t('settings.btn_hide'); }
    else { input.type = 'password'; btn.textContent = window.t('settings.btn_show'); }
  }

  // ─── Access Control ───

  async function loadAccessControl() {
    try {
      const data = await Panoptica.api('/api/settings/access-control');
      const setField = (field, id) => {
        const el = document.getElementById(`access-${field}-id`);
        if (el) {
          el.value = id || '';
          el.dataset.lastVerified = '';
          el.classList.remove('resolved', 'invalid');
          const res = document.getElementById(`access-${field}-result`);
          if (res) { res.textContent = ''; res.className = 'access-result'; }
        }
        if (id) verifyAccessField(field); // auto-verify saved values on load
      };
      setField('admin',  data.admin_group_id);
      setField('member', data.member_group_id);
      setField('viewer', data.viewer_group_id);
    } catch (err) {
      Panoptica.showToast(window.t('settings.toast_access_load_failed', { message: err.message }), 'error');
    }
  }

  async function verifyAccessField(field) {
    const input = document.getElementById(`access-${field}-id`);
    const resultEl = document.getElementById(`access-${field}-result`);
    const btn = document.querySelector(`.access-verify-btn[data-field="${field}"]`);
    if (!input || !resultEl) return;
    const id = input.value.trim();
    if (!id) {
      input.classList.remove('resolved', 'invalid');
      resultEl.textContent = '';
      resultEl.className = 'access-result';
      return;
    }
    // Fast-fail client-side GUID check
    const guidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!guidRe.test(id)) {
      input.classList.remove('resolved');
      input.classList.add('invalid');
      resultEl.textContent = window.t('settings.access.invalid_guid');
      resultEl.className = 'access-result err';
      return;
    }

    resultEl.textContent = window.t('settings.access.verifying');
    resultEl.className = 'access-result pending';
    input.classList.remove('resolved', 'invalid');
    btn?.classList.add('busy');

    try {
      const data = await Panoptica.api(`/api/settings/access-control/verify-group/${encodeURIComponent(id)}`);
      input.classList.add('resolved');
      input.dataset.lastVerified = id;
      const name = data.security_enabled === false
        ? data.display_name + window.t('settings.access.mail_enabled_suffix')
        : data.display_name;
      resultEl.textContent = window.t('settings.access.verify_ok', { name });
      resultEl.className = 'access-result ok';
    } catch (err) {
      input.classList.add('invalid');
      resultEl.textContent = window.t('settings.access.verify_failed', { message: err.message || window.t('settings.access.verify_failed_default') });
      resultEl.className = 'access-result err';
    } finally {
      btn?.classList.remove('busy');
    }
  }

  async function saveAccessControl() {
    const statusEl = document.getElementById('access-status');
    statusEl.textContent = window.t('settings.status.saving');
    statusEl.style.color = 'var(--p-text-muted)';
    const payload = {
      admin_group_id:  document.getElementById('access-admin-id').value.trim(),
      member_group_id: document.getElementById('access-member-id').value.trim(),
      viewer_group_id: document.getElementById('access-viewer-id').value.trim(),
    };
    try {
      await Panoptica.api('/api/settings/access-control', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      statusEl.textContent = window.t('settings.status.saved');
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.toast_access_saved'), 'success');
    } catch (err) {
      statusEl.textContent = window.t('settings.status.error');
      statusEl.style.color = '#e74c3c';
      Panoptica.showToast(window.t('settings.toast_save_failed', { message: err.message }), 'error');
    }
  }

  // ─── Report Branding ───

  // Pending logo state, set by the file picker / remove button and consumed by
  // saveBranding(). null data-url = no new upload this session.
  let brandingPendingLogo = null;   // data URL string when a new PNG is staged
  let brandingRemoveLogo = false;   // true when the operator clicked Remove
  const BRANDING_MAX_BYTES = 2 * 1024 * 1024;

  async function loadBranding() {
    brandingPendingLogo = null;
    brandingRemoveLogo = false;
    const fileEl = document.getElementById('branding-logo-file');
    if (fileEl) fileEl.value = '';
    try {
      const data = await Panoptica.api('/api/settings/branding');
      document.getElementById('branding-company-name').value = data.company_name || '';
      setBrandingPreview(data.logo_url || null);
    } catch (err) {
      Panoptica.showToast(window.t('settings.branding.toast_load_failed', { message: err.message }), 'error');
    }
  }

  // src = a URL/data-URL to show, or null to show the "no logo" placeholder.
  function setBrandingPreview(src) {
    const img = document.getElementById('branding-logo-preview');
    const empty = document.getElementById('branding-logo-empty');
    if (!img || !empty) return;
    if (src) {
      img.src = src;
      img.style.display = '';
      empty.style.display = 'none';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
      empty.style.display = '';
    }
  }

  function onBrandingLogoPicked(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('branding-status');
    if (file.type !== 'image/png') {
      if (statusEl) { statusEl.textContent = window.t('settings.branding.err_not_png'); statusEl.style.color = '#e67e22'; }
      e.target.value = '';
      return;
    }
    if (file.size > BRANDING_MAX_BYTES) {
      if (statusEl) { statusEl.textContent = window.t('settings.branding.err_too_large'); statusEl.style.color = '#e67e22'; }
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      brandingPendingLogo = reader.result; // data:image/png;base64,...
      brandingRemoveLogo = false;
      setBrandingPreview(brandingPendingLogo);
      if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
    };
    reader.onerror = () => {
      if (statusEl) { statusEl.textContent = window.t('settings.branding.err_read'); statusEl.style.color = '#e74c3c'; }
    };
    reader.readAsDataURL(file);
  }

  function removeBrandingLogo() {
    brandingPendingLogo = null;
    brandingRemoveLogo = true;
    const fileEl = document.getElementById('branding-logo-file');
    if (fileEl) fileEl.value = '';
    setBrandingPreview(null);
  }

  async function saveBranding() {
    const statusEl = document.getElementById('branding-status');
    statusEl.textContent = window.t('settings.status.saving');
    statusEl.style.color = 'var(--p-text-muted)';
    const payload = {
      company_name: document.getElementById('branding-company-name').value.trim(),
    };
    if (brandingPendingLogo) payload.logo = brandingPendingLogo;
    else if (brandingRemoveLogo) payload.remove_logo = true;
    try {
      await Panoptica.api('/api/settings/branding', { method: 'PUT', body: JSON.stringify(payload) });
      statusEl.textContent = window.t('settings.status.saved');
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.branding.toast_saved'), 'success');
      setTimeout(loadBranding, 500);
    } catch (err) {
      statusEl.textContent = window.t('settings.status.error');
      statusEl.style.color = '#e74c3c';
      Panoptica.showToast(window.t('settings.toast_save_failed', { message: err.message }), 'error');
    }
  }

  // ─── PSA Integration (Feature 8.3) ───

  let psaConfig = null;          // last-loaded /api/psa/config
  let psaCompanies = [];         // company list from /api/psa/mapping (≤200)
  let psaCompanySearchTimer = null;
  const PSA_SEVERITIES = ['severe', 'high', 'medium', 'low', 'info'];

  function psaEl(id) { return document.getElementById(id); }
  function psaVal(id) { const el = psaEl(id); return el ? el.value.trim() : ''; }
  function psaNumOrNull(id) {
    const v = psaVal(id);
    return v === '' ? null : (parseInt(v, 10));
  }

  function psaPopulateSelect(el, items, selected) {
    if (!el) return;
    el.innerHTML = (items || [])
      .map(it => `<option value="${it.value}">${escHtml(it.label)}</option>`)
      .join('');
    if (selected != null) el.value = String(selected);
  }

  function onPsaProviderChange() {
    const provider = psaVal('psa-provider');
    const isAt = provider === 'autotask';
    const creds = psaEl('psa-creds');
    if (creds) creds.style.display = isAt ? '' : 'none';
    if (!isAt) {
      const cfg = psaEl('psa-config-sections');
      if (cfg) cfg.style.display = 'none';
    }
    const warn = psaEl('psa-email-warning');
    if (warn) warn.style.display = (isAt && psaConfig && !psaConfig.psa_email_set) ? '' : 'none';
  }

  async function loadPsa() {
    try {
      psaConfig = await Panoptica.api('/api/psa/config');
    } catch (err) {
      Panoptica.showToast(window.t('psa.settings.save_failed', { error: err.message }), 'error');
      return;
    }
    const cfg = psaConfig;
    if (psaEl('psa-provider')) psaEl('psa-provider').value = cfg.provider || '';
    if (psaEl('psa-username')) psaEl('psa-username').value = cfg.username || '';
    if (psaEl('psa-integration-code')) psaEl('psa-integration-code').value = cfg.integration_code || '';
    if (psaEl('psa-secret')) psaEl('psa-secret').value = '';
    if (psaEl('psa-secret-hint')) psaEl('psa-secret-hint').style.display = cfg.secret_set ? '' : 'none';
    if (psaEl('psa-ticket-language')) psaEl('psa-ticket-language').value = cfg.ticket_language || 'en';
    if (psaEl('psa-test-status')) psaEl('psa-test-status').textContent = '';
    onPsaProviderChange();

    // Already-credentialed Autotask install: pull live picklists + mapping + health.
    if (cfg.provider === 'autotask' && cfg.zone_url) {
      await loadPsaPicklistsAndConfig(cfg);
      await loadPsaMapping();
      await loadPsaHealth();
    }
    if (window.PanopticaI18n && window.PanopticaI18n.applyTo) {
      window.PanopticaI18n.applyTo(psaEl('settings-psa-view'));
    }
  }

  async function testPsaConnection() {
    const status = psaEl('psa-test-status');
    status.style.color = 'var(--p-text-muted)';
    status.textContent = window.t('psa.settings.testing');
    const username = psaVal('psa-username');
    const integration = psaVal('psa-integration-code');
    const secret = psaEl('psa-secret') ? psaEl('psa-secret').value : '';
    try {
      const r = await Panoptica.api('/api/psa/test', {
        method: 'POST',
        body: JSON.stringify({ username, integration_code: integration, secret }),
      });
      if (!r.ok) {
        status.style.color = '#e74c3c';
        status.textContent = window.t('psa.settings.test_fail', { error: r.error || '' });
        return;
      }
      status.style.color = '#27ae60';
      status.textContent = window.t('psa.settings.test_success', { zone: r.zone_url || '' });
      // Persist creds so the server-side picklist/company calls authenticate.
      await Panoptica.api('/api/psa/config', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'autotask', username, integration_code: integration, secret: secret || undefined }),
      });
      if (psaEl('psa-secret')) psaEl('psa-secret').value = '';
      if (psaEl('psa-secret-hint')) psaEl('psa-secret-hint').style.display = '';
      psaConfig = await Panoptica.api('/api/psa/config');
      await loadPsaPicklistsAndConfig(psaConfig);
      await loadPsaMapping();
      await loadPsaHealth();
    } catch (err) {
      status.style.color = '#e74c3c';
      status.textContent = window.t('psa.settings.test_fail', { error: err.message });
    }
  }

  async function loadPsaPicklistsAndConfig(cfg) {
    let pl;
    try {
      pl = await Panoptica.api('/api/psa/picklists');
    } catch (err) {
      Panoptica.showToast(window.t('psa.settings.test_fail', { error: err.message }), 'error');
      return;
    }
    const tcfg = cfg.ticket_config || {};
    psaPopulateSelect(psaEl('psa-queue'), pl.queue, tcfg.queueId);
    psaPopulateSelect(psaEl('psa-source'), pl.source, tcfg.sourceId);
    psaPopulateSelect(psaEl('psa-new-status'), pl.status, tcfg.newStatusId);
    psaPopulateSelect(psaEl('psa-close-status'), pl.status, tcfg.closeStatusId);
    psaPopulateSelect(psaEl('psa-note-type'), pl.noteType, tcfg.noteTypeId);
    psaPopulateSelect(psaEl('psa-publish'), pl.publish, tcfg.publishId);
    if (psaEl('psa-due-offset')) psaEl('psa-due-offset').value = tcfg.dueDateOffsetHours || 24;

    // Complete-statuses checkboxes.
    const csWrap = psaEl('psa-complete-statuses');
    const selected = new Set((tcfg.completeStatusIds || []).map(Number));
    if (csWrap) {
      csWrap.innerHTML = (pl.status || []).map(s =>
        `<label style="display:inline-flex;align-items:center;gap:4px;border:1px solid rgba(255,255,255,0.22);border-radius:14px;padding:3px 10px;font-size:0.8rem;cursor:pointer;">
           <input type="checkbox" class="psa-complete-cb" value="${s.value}" ${selected.has(Number(s.value)) ? 'checked' : ''}/> ${escHtml(s.label)}
         </label>`).join('');
    }

    // Severity → priority rows.
    const spWrap = psaEl('psa-severity-priority');
    const pmap = tcfg.priorityBySeverity || {};
    if (spWrap) {
      spWrap.innerHTML = PSA_SEVERITIES.map(sev => {
        const sevLabel = window.t('alerts.' + sev);
        const opts = (pl.priority || []).map(p =>
          `<option value="${p.value}" ${String(pmap[sev]) === String(p.value) ? 'selected' : ''}>${escHtml(p.label)}</option>`).join('');
        return `<div class="form-row" style="align-items:center;margin-bottom:6px;">
            <div style="flex:1;text-transform:capitalize;">${escHtml(sevLabel)}</div>
            <div style="flex:2;"><select class="psa-priority-sel" data-sev="${sev}">${opts}</select></div>
          </div>`;
      }).join('');
    }

    // Default company — seed with the current mapping if known.
    const dc = psaEl('psa-default-company');
    if (dc) {
      const opts = [`<option value="">${escHtml(window.t('psa.settings.company_none'))}</option>`];
      if (cfg.default_company_id != null) {
        opts.push(`<option value="${cfg.default_company_id}" selected>#${cfg.default_company_id}</option>`);
      }
      dc.innerHTML = opts.join('');
    }

    const sections = psaEl('psa-config-sections');
    if (sections) sections.style.display = '';
  }

  function debouncePsaCompanySearch() {
    clearTimeout(psaCompanySearchTimer);
    psaCompanySearchTimer = setTimeout(doPsaCompanySearch, 350);
  }

  async function doPsaCompanySearch() {
    const term = psaVal('psa-default-company-search');
    const dc = psaEl('psa-default-company');
    if (!dc) return;
    try {
      const r = await Panoptica.api('/api/psa/companies?search=' + encodeURIComponent(term));
      const current = dc.value;
      const opts = [`<option value="">${escHtml(window.t('psa.settings.company_none'))}</option>`];
      for (const c of (r.companies || [])) {
        opts.push(`<option value="${c.id}">${escHtml(c.name)}</option>`);
      }
      dc.innerHTML = opts.join('');
      if (current) dc.value = current;
    } catch (err) {
      Panoptica.showToast(window.t('psa.settings.save_failed', { error: err.message }), 'error');
    }
  }

  async function savePsaConfig() {
    const status = psaEl('psa-config-status');
    status.style.color = 'var(--p-text-muted)';
    status.textContent = window.t('settings.status.saving');
    const completeIds = Array.from(document.querySelectorAll('.psa-complete-cb'))
      .filter(cb => cb.checked).map(cb => parseInt(cb.value, 10));
    const priorityBySeverity = {};
    document.querySelectorAll('.psa-priority-sel').forEach(sel => {
      priorityBySeverity[sel.dataset.sev] = parseInt(sel.value, 10);
    });
    const ticket_config = {
      queueId: psaNumOrNull('psa-queue'),
      sourceId: psaNumOrNull('psa-source'),
      newStatusId: psaNumOrNull('psa-new-status'),
      closeStatusId: psaNumOrNull('psa-close-status'),
      completeStatusIds: completeIds,
      priorityBySeverity,
      noteTypeId: psaNumOrNull('psa-note-type'),
      publishId: psaNumOrNull('psa-publish'),
      dueDateOffsetHours: parseInt(psaVal('psa-due-offset'), 10) || 24,
    };
    const secret = psaEl('psa-secret') ? psaEl('psa-secret').value : '';
    const body = {
      provider: psaVal('psa-provider'),
      username: psaVal('psa-username'),
      integration_code: psaVal('psa-integration-code'),
      default_company_id: psaVal('psa-default-company') || null,
      ticket_language: psaVal('psa-ticket-language'),
      ticket_config,
    };
    if (secret) body.secret = secret;
    try {
      await Panoptica.api('/api/psa/config', { method: 'PUT', body: JSON.stringify(body) });
      status.style.color = '#27ae60';
      status.textContent = window.t('psa.settings.saved');
      if (psaEl('psa-secret')) psaEl('psa-secret').value = '';
      psaConfig = await Panoptica.api('/api/psa/config');
      onPsaProviderChange();
    } catch (err) {
      status.style.color = '#e74c3c';
      const msg = (err && err.message) || '';
      status.textContent = msg.includes('close_status_not_in_complete')
        ? window.t('psa.settings.err_close_not_complete')
        : window.t('psa.settings.save_failed', { error: msg });
    }
  }

  // ─── Tenant → company mapping ───

  async function loadPsaMapping() {
    let data;
    try {
      data = await Panoptica.api('/api/psa/mapping');
    } catch (err) {
      Panoptica.showToast(window.t('psa.settings.save_failed', { error: err.message }), 'error');
      return;
    }
    psaCompanies = data.companies || [];
    const body = psaEl('psa-mapping-body');
    if (!body) return;
    body.innerHTML = (data.tenants || []).map(t => psaMappingRowHtml(t)).join('');
    const countEl = psaEl('psa-unmapped-count');
    if (countEl) countEl.textContent = window.t('psa.settings.unmapped_count', { count: data.unmapped_count });
  }

  function psaCompanyOptionsHtml(selectedId, suggestedId) {
    const noneLabel = window.t('psa.settings.company_none');
    const preselect = selectedId != null ? Number(selectedId) : (suggestedId != null ? Number(suggestedId) : null);
    let opts = `<option value="">${escHtml(noneLabel)}</option>`;
    const seen = new Set();
    for (const c of psaCompanies) {
      seen.add(Number(c.id));
      opts += `<option value="${c.id}" ${preselect === Number(c.id) ? 'selected' : ''}>${escHtml(c.name)}</option>`;
    }
    // Ensure a mapped/suggested company not in the ≤200 list is still selectable.
    for (const extra of [selectedId, suggestedId]) {
      if (extra != null && !seen.has(Number(extra))) {
        seen.add(Number(extra));
        opts += `<option value="${extra}" ${preselect === Number(extra) ? 'selected' : ''}>#${extra}</option>`;
      }
    }
    return opts;
  }

  function psaMappingRowHtml(t) {
    const isSuggested = t.company_id == null && t.suggested_company_id != null;
    const statusBadge = t.company_id != null
      ? ''
      : (isSuggested
        ? `<span style="border:1px dashed #4488ff;border-radius:10px;padding:1px 8px;color:#4488ff;font-size:0.75rem;">${escHtml(window.t('psa.settings.suggested_badge'))}</span>`
        : `<span style="border:1px solid rgba(255,255,255,0.22);border-radius:10px;padding:1px 8px;color:var(--p-text-muted);font-size:0.75rem;">${escHtml(window.t('psa.settings.email_fallback_badge'))}</span>`);
    return `<tr data-tenant-id="${t.tenant_id}" style="border-bottom:1px solid rgba(255,255,255,0.08);">
        <td style="padding:8px;">${escHtml(t.display_name)}</td>
        <td style="padding:8px;color:var(--p-text-muted);">${escHtml(t.psa_name || '—')}</td>
        <td style="padding:8px;">
          <select class="psa-map-sel" data-tenant-id="${t.tenant_id}" data-suggested="${t.suggested_company_id != null ? t.suggested_company_id : ''}" style="min-width:240px;">
            ${psaCompanyOptionsHtml(t.company_id, t.suggested_company_id)}
          </select>
        </td>
        <td style="padding:8px;" class="psa-map-status">${statusBadge}</td>
      </tr>`;
  }

  function suggestPsaMatches() {
    // Apply each row's suggested company into its select (operator still must Save).
    document.querySelectorAll('.psa-map-sel').forEach(sel => {
      const suggested = sel.dataset.suggested;
      if (suggested && !sel.value) sel.value = suggested;
    });
    Panoptica.showToast(window.t('psa.settings.suggest_matches'), 'info');
  }

  async function savePsaMapping() {
    const status = psaEl('psa-mapping-status');
    status.style.color = 'var(--p-text-muted)';
    status.textContent = window.t('settings.status.saving');
    const mappings = Array.from(document.querySelectorAll('.psa-map-sel')).map(sel => ({
      tenant_id: parseInt(sel.dataset.tenantId, 10),
      company_id: sel.value === '' ? null : parseInt(sel.value, 10),
    }));
    try {
      await Panoptica.api('/api/psa/mapping', { method: 'POST', body: JSON.stringify({ mappings }) });
      status.style.color = '#27ae60';
      status.textContent = window.t('psa.settings.mapping_saved');
      await loadPsaMapping();
    } catch (err) {
      status.style.color = '#e74c3c';
      status.textContent = window.t('psa.settings.save_failed', { error: err.message });
    }
  }

  async function loadPsaHealth() {
    const el = psaEl('psa-health');
    if (!el) return;
    try {
      const h = await Panoptica.api('/api/psa/health');
      const fmtTs = (iso) => iso ? fmtDate(iso) + ' ' + new Date(iso).toLocaleTimeString() : window.t('psa.settings.never');
      const authLine = h.auth_healthy
        ? `<span style="color:#27ae60;">● ${escHtml(window.t('psa.settings.auth_ok'))}</span>`
        : `<span style="color:#e74c3c;">● ${escHtml(window.t('psa.settings.auth_fail', { since: fmtTs(h.auth_failed_since) }))}</span>`;
      el.innerHTML = `
        ${authLine}<br>
        ${escHtml(window.t('psa.settings.last_poll'))}: ${escHtml(fmtTs(h.last_poll_at))}<br>
        ${escHtml(window.t('psa.settings.open_tickets'))}: ${h.open_tickets}<br>
        ${escHtml(window.t('psa.settings.error_links'))}: ${h.error_links}`;
    } catch (err) {
      el.textContent = '';
    }
  }

  window.PanopticaPage = { init, destroy };
})();
