/**
 * Panoptica365 — Add to Roll-up (2026-06-29)
 *
 * Operator escape-hatch that the create-time Merge can't provide: fold existing
 * open alerts into an EXISTING open roll-up, from two entry points.
 *   - From alerts (bulk bar): Panoptica.RollupAdd.addToRollup(alertIds, tenantId, opts)
 *       → picks a target roll-up, the selected alerts become its children.
 *   - From a roll-up (slideout): Panoptica.RollupAdd.addAlertsToRollup(parentId, tenantId, opts)
 *       → picks this tenant's addable open alerts to fold in.
 * Both converge on POST /api/alerts/rollup/:parentId/children. Purely manual —
 * no affinity/dedup matching. Self-contained dynamic modals so both entry points
 * work regardless of which page hosts the slideout. opts.onDone(parentId) fires
 * after a successful add (caller refreshes its view). opts.parentMessage labels
 * the modal-B intro.
 */
(function () {
  'use strict';

  function t(key, params) { return (window.t ? window.t(key, params) : key); }
  function toast(msg, type) { if (window.Panoptica && Panoptica.showToast) Panoptica.showToast(msg, type || 'success'); }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }

  function sevChip(sev) {
    const s = sev || 'info';
    return `<span class="alert-severity-badge sev-${escHtml(s)}" style="font-size:0.7rem;">${escHtml(t('alerts.' + s) || s)}</span>`;
  }

  function fmtTime(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang && window.PanopticaI18n.currentLang()) || 'en';
      const loc = lang === 'fr' ? 'fr-CA' : (lang === 'es' ? 'es' : 'en-CA');
      return d.toLocaleString(loc, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (_) { return ''; }
  }

  // Stable server 400 codes → localized error toasts.
  const ERR_KEYS = {
    parent_not_open: 'alerts.add_err_parent_not_open',
    parent_not_found: 'alerts.add_err_parent_not_found',
    not_addable: 'alerts.add_err_not_addable',
    multi_tenant: 'alerts.add_err_multi_tenant',
    too_few: 'alerts.add_err_too_few',
    not_found: 'alerts.add_err_not_found',
  };
  function toastError(e) {
    const code = (e && e.message) || '';
    toast(t(ERR_KEYS[code] || 'alerts.add_err_generic'), 'error');
  }

  function postAddChildren(parentId, alertIds) {
    return Panoptica.api(`/api/alerts/rollup/${encodeURIComponent(parentId)}/children`, {
      method: 'POST',
      body: JSON.stringify({ alert_ids: alertIds }),
    });
  }

  // ── Modal scaffold (dynamic overlay; mirrors psa-resolve-modal.js) ──
  function buildModal({ title, intro, scrollBody }) {
    const overlay = document.createElement('div');
    overlay.className = 'rollup-add-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;';
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--p-surface,#16162a);border:1px solid rgba(255,255,255,0.22);border-radius:10px;max-width:560px;width:92%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,0.5);';
    card.innerHTML = `
      <div style="padding:20px 24px 8px;">
        <div style="font-family:Inter,sans-serif;font-size:1.1rem;color:var(--p-text,#e0e0e0);margin-bottom:6px;">${escHtml(title)}</div>
        <div style="font-family:Inter,sans-serif;font-size:0.88rem;color:var(--p-text-muted,#aaa);line-height:1.5;">${escHtml(intro)}</div>
      </div>
      <div class="rollup-add-list" style="overflow-y:auto;padding:6px 24px;flex:1 1 auto;min-height:60px;"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding:12px 24px 20px;flex-wrap:wrap;">
        <button class="btn-secondary" data-act="cancel">${escHtml(t('alerts.rollup_btn_cancel') || 'Cancel')}</button>
        <button class="btn-primary" data-act="confirm" disabled>${escHtml(t('alerts.add_confirm_btn') || 'Add')}</button>
      </div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    card.querySelector('[data-act="cancel"]').addEventListener('click', close);
    void scrollBody;
    return {
      close,
      list: card.querySelector('.rollup-add-list'),
      confirmBtn: card.querySelector('[data-act="confirm"]'),
    };
  }

  // Single-OK info modal (empty-state messages).
  function infoModal(message) {
    const overlay = document.createElement('div');
    overlay.className = 'rollup-add-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;';
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--p-surface,#16162a);border:1px solid rgba(255,255,255,0.22);border-radius:10px;max-width:460px;width:90%;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,0.5);';
    card.innerHTML = `
      <div style="font-family:Inter,sans-serif;font-size:0.95rem;color:var(--p-text,#e0e0e0);line-height:1.5;margin-bottom:18px;">${escHtml(message)}</div>
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn-primary" data-act="ok">${escHtml(t('alerts.rollup_ok') || 'OK')}</button>
      </div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    card.querySelector('[data-act="ok"]').addEventListener('click', close);
  }

  // ── Entry A: from alerts → pick a roll-up ──
  async function addToRollup(alertIds, tenantId, opts = {}) {
    const ids = (alertIds || []).map(Number).filter(Number.isFinite);
    if (ids.length === 0) return;

    let rollups = [];
    try {
      const r = await Panoptica.api(`/api/alerts/rollups?tenant_id=${encodeURIComponent(tenantId)}&status=open`);
      rollups = (r && r.rollups) || [];
    } catch (e) { toastError(e); return; }

    if (rollups.length === 0) { infoModal(t('alerts.add_no_rollups')); return; }

    const m = buildModal({
      title: t('alerts.add_to_rollup_title'),
      intro: t('alerts.add_to_rollup_intro', { count: ids.length }),
    });
    let selected = null;
    m.list.innerHTML = rollups.map(ru => `
      <label class="rollup-add-row" style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid rgba(255,255,255,0.08);cursor:pointer;">
        <input type="radio" name="rollup-add-pick" value="${escHtml(String(ru.id))}">
        ${sevChip(ru.severity)}
        <span style="flex:1;color:var(--p-text,#e0e0e0);font-size:0.88rem;">${escHtml(ru.message || ('#' + ru.id))}</span>
        <span style="color:var(--p-text-muted,#888);font-size:0.76rem;white-space:nowrap;">${escHtml(t('alerts.add_rollup_child_count', { count: ru.child_count }))}</span>
      </label>`).join('');
    m.list.querySelectorAll('input[name="rollup-add-pick"]').forEach(rb => {
      rb.addEventListener('change', () => { selected = parseInt(rb.value, 10); m.confirmBtn.disabled = !selected; });
    });
    m.confirmBtn.addEventListener('click', async () => {
      if (!selected) return;
      m.confirmBtn.disabled = true;
      try {
        const res = await postAddChildren(selected, ids);
        m.close();
        toast(t('alerts.toast_rollup_added', { count: (res && res.added) || ids.length }), 'success');
        if (window.Panoptica && Panoptica.refreshAlertSignals) Panoptica.refreshAlertSignals();
        if (typeof opts.onDone === 'function') opts.onDone(selected);
      } catch (e) {
        m.confirmBtn.disabled = false;
        toastError(e);
      }
    });
  }

  // ── Entry B: from a roll-up → pick alerts to add ──
  async function addAlertsToRollup(parentId, tenantId, opts = {}) {
    const pid = Number(parentId);
    if (!Number.isFinite(pid)) return;

    let candidates = [];
    try {
      // Reuse the alerts list (open by default). High limit so the picker covers
      // a tenant's open set; the server re-validates every id on submit anyway.
      const r = await Panoptica.api(`/api/alerts?tenant_id=${encodeURIComponent(tenantId)}&limit=200`);
      candidates = ((r && r.alerts) || []).filter(a =>
        !a.is_rollup &&
        a.rollup_parent_id == null &&
        Number(a.id) !== pid &&
        (a.status === 'new' || a.status === 'investigating')
      );
    } catch (e) { toastError(e); return; }

    if (candidates.length === 0) { infoModal(t('alerts.rollup_add_no_candidates')); return; }

    const m = buildModal({
      title: t('alerts.rollup_add_alerts_title'),
      intro: t('alerts.rollup_add_alerts_intro', { title: opts.parentMessage || ('#' + pid) }),
    });
    const chosen = new Set();
    m.list.innerHTML = candidates.map(a => `
      <label class="rollup-add-row" style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid rgba(255,255,255,0.08);cursor:pointer;">
        <input type="checkbox" value="${escHtml(String(a.id))}">
        ${sevChip(a.severity)}
        <span style="flex:1;color:var(--p-text,#e0e0e0);font-size:0.88rem;">${escHtml(a.message || ('#' + a.id))}</span>
        <span style="color:var(--p-text-muted,#888);font-size:0.76rem;white-space:nowrap;">${escHtml(fmtTime(a.triggered_at))}</span>
      </label>`).join('');
    m.list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = parseInt(cb.value, 10);
        if (cb.checked) chosen.add(id); else chosen.delete(id);
        m.confirmBtn.disabled = chosen.size === 0;
      });
    });
    m.confirmBtn.addEventListener('click', async () => {
      if (chosen.size === 0) return;
      m.confirmBtn.disabled = true;
      try {
        const res = await postAddChildren(pid, [...chosen]);
        m.close();
        toast(t('alerts.toast_rollup_added', { count: (res && res.added) || chosen.size }), 'success');
        if (window.Panoptica && Panoptica.refreshAlertSignals) Panoptica.refreshAlertSignals();
        if (typeof opts.onDone === 'function') opts.onDone(pid);
      } catch (e) {
        m.confirmBtn.disabled = false;
        toastError(e);
      }
    });
  }

  window.Panoptica = window.Panoptica || {};
  window.Panoptica.RollupAdd = { addToRollup, addAlertsToRollup };
})();
