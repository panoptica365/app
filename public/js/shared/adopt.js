/**
 * Panoptica365 — Adopt-in-Place frontend (tenant-sourced CA & Intune cards)
 *
 * Renders, on the CA Policies + Intune tabs:
 *   - the "Import existing settings" button (Member+; hidden once a surface's
 *     import has succeeded — driven by /api/adopt/:id/state)
 *   - the Security Defaults on/off status indicator (CA tab; NOT a card — §2.6)
 *   - the tenant-sourced cards (red left-edge + "Tenant-sourced" badge — §2.4)
 *   - the three lifecycle actions with friction scaled to blast radius (§2.10)
 *
 * Exposed as window.Panoptica.Adopt.load(tenantId, surface); the tenant-dashboard
 * calls it when the CA / Intune tab opens. Role gating is automatic: dynamic
 * buttons carry data-role-required="member" and app.js's MutationObserver hides
 * them for Viewers.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function t(key, params) {
    try { return window.t ? window.t('tenant_dashboard.adopt.' + key, params) : key; }
    catch (_e) { return key; }
  }
  function toast(msg, kind) {
    if (window.Panoptica && Panoptica.showToast) Panoptica.showToast(msg, kind || 'info');
  }
  function api(path, opts) { return window.Panoptica.api(path, opts); }
  function applyI18n(node) {
    if (node && window.PanopticaI18n) window.PanopticaI18n.applyTo(node);
  }

  // ─── one-time style injection (red left-edge + badges) ───
  function ensureStyles() {
    if (document.getElementById('adopt-styles')) return;
    const css = `
      .td-adopt-section { margin-top: 28px; }
      .td-adopt-head { font-size: 0.92rem; font-weight: 600; color: var(--p-text); margin-bottom: 4px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .td-adopt-sub { font-size: 0.78rem; color: var(--p-text-muted); margin-bottom: 12px; }
      .td-adopt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
      .td-adopt-card { border: 1px solid var(--p-border, rgba(150,150,180,0.25)); border-left: 4px solid var(--p-danger, #d9534f);
                       border-radius: 8px; padding: 12px 14px; background: var(--p-surface, rgba(127,127,127,0.04)); color: var(--p-text, inherit); }
      .td-adopt-card.inactive { opacity: 0.82; }
      .td-adopt-badge { display:inline-block; font-size:0.66rem; font-weight:700; letter-spacing:0.02em; text-transform:uppercase;
                        padding:2px 7px; border-radius:10px; background: var(--p-danger, #d9534f); color:#fff; }
      .td-adopt-pill { display:inline-block; font-size:0.68rem; padding:2px 8px; border-radius:10px; margin-left:6px; }
      .td-adopt-pill.active { background: rgba(60,170,90,0.18); color: var(--p-success, #3caa5a); }
      .td-adopt-pill.inactive { background: rgba(150,150,150,0.2); color: var(--p-text-muted); }
      .td-adopt-pill.drift { background: rgba(217,83,79,0.18); color: var(--p-danger, #d9534f); }
      .td-adopt-pill.managed { background: rgba(90,120,210,0.18); color:#5a78d2; }
      .td-adopt-name { font-weight:600; font-size:0.9rem; margin:8px 0 2px; word-break: break-word; }
      .td-adopt-meta { font-size:0.74rem; color: var(--p-text-muted); margin-bottom:8px; }
      .td-adopt-secdef { font-size:0.78rem; color: var(--p-text-muted); margin: 0 0 12px; }
      .td-adopt-empty { font-size:0.82rem; color: var(--p-text-muted); padding: 6px 0; }
      .adopt-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index: 9000; }
      .adopt-modal { width: 520px; max-width: 94vw; background: var(--p-surface, #0b1e33); color: var(--p-text, #14202e); border: 1px solid var(--p-border, rgba(127,127,127,0.3)); border-radius: 10px; padding: 20px; box-shadow: 0 12px 40px rgba(0,0,0,0.4); }
      .adopt-modal h3 { margin: 0 0 8px; font-size: 1.05rem; }
      .adopt-modal .warn { background: rgba(217,83,79,0.12); border:1px solid rgba(217,83,79,0.3); border-radius:6px; padding:10px 12px; font-size:0.84rem; margin:10px 0; }
      .adopt-modal label.row { display:flex; gap:8px; align-items:flex-start; font-size:0.84rem; margin:10px 0; }
      .adopt-modal input[type=text] { width:100%; padding:7px 9px; border-radius:6px; border:1px solid var(--p-border, rgba(150,150,180,0.3)); background: var(--p-surface-sunken, rgba(127,127,127,0.12)); color:var(--p-text, inherit); margin-top:6px; }
      .adopt-modal .actions { display:flex; gap:8px; justify-content:flex-end; margin-top:16px; flex-wrap:wrap; }
      .adopt-modal .sep { border-top:1px solid var(--p-border, rgba(150,150,180,0.2)); margin:14px 0; }
      .adopt-modal .panoptica-only { font-size:0.74rem; color: var(--p-text-muted); margin-top:4px; }
      .adopt-tiles { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:18px 0 0; }
      .adopt-tile { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px; padding:14px 6px; min-height:96px;
                    border:1px solid var(--p-border, rgba(127,127,127,0.3)); border-radius:8px; background: var(--p-surface-alt, rgba(127,127,127,0.06));
                    color: var(--p-text, inherit); cursor:pointer; text-align:center; transition: background .15s, border-color .15s; }
      .adopt-tile:hover { background: var(--p-surface-sunken, rgba(127,127,127,0.12)); border-color: var(--p-accent, #5ccbf4); }
      .adopt-tile svg { width:22px; height:22px; }
      .adopt-tile .lbl { font-size:0.82rem; font-weight:600; }
      .adopt-tile .hint { font-size:0.68rem; color: var(--p-text-muted); }
      .adopt-tile-danger { border-color: var(--p-danger,#d9534f); background: rgba(217,83,79,0.10); color: var(--p-danger,#d9534f); }
      .adopt-tile-danger:hover { background: rgba(217,83,79,0.18); border-color: var(--p-danger,#d9534f); }
      .adopt-tile-danger .lbl, .adopt-tile-danger .hint, .adopt-tile-danger svg { color: var(--p-danger,#d9534f); }
      .adopt-footnote { display:flex; align-items:center; gap:6px; font-size:0.72rem; color: var(--p-text-muted); margin:12px 0 0; }
      .adopt-footnote svg { width:14px; height:14px; flex-shrink:0; }
      .adopt-cancel-row { display:flex; justify-content:flex-end; margin-top:18px; padding-top:12px; border-top:1px solid var(--p-border, rgba(127,127,127,0.2)); }
    `;
    const style = document.createElement('style');
    style.id = 'adopt-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ─── data ───
  const ctx = { ca: { tenantId: null }, intune: { tenantId: null } };

  async function load(tenantId, surface) {
    ensureStyles();
    if (surface !== 'ca' && surface !== 'intune') return;
    ctx[surface].tenantId = tenantId;
    const container = document.getElementById('td-adopt-' + surface);
    if (!container) return;
    container.innerHTML = '';
    // The Import button is ALWAYS available (re-import is idempotent — matches by
    // object id, skips managed/adopted/dismissed). Shown independent of the fetch
    // below so a transient state-read error never strands the operator.
    showImportButton(surface, tenantId);

    let state, cardsResp;
    try {
      [state, cardsResp] = await Promise.all([
        api('/api/adopt/' + tenantId + '/state'),
        api('/api/adopt/' + tenantId + '/cards?surface=' + surface),
      ]);
    } catch (e) {
      container.innerHTML = '<div class="td-adopt-empty">' + esc(t('load_failed')) + '</div>';
      return;
    }

    // Per-surface import state (drives the empty-state copy below). Guard so a
    // missing/odd-shaped /state response can never throw and strand the operator.
    const surfState = (state && state.surfaces && state.surfaces[surface]) || {};

    const parts = [];
    // Security Defaults indicator — CA tab only, status-only (§2.6).
    if (surface === 'ca' && state && state.security_defaults) {
      const sd = state.security_defaults;
      const status = sd.unavailable ? t('secdef_unknown')
        : (sd.enabled ? t('secdef_on') : t('secdef_off'));
      parts.push('<div class="td-adopt-secdef">' + esc(t('secdef_label')) + ' <strong>' + esc(status) + '</strong></div>');
    }

    const cards = (cardsResp && cardsResp.cards) || [];
    if (cards.length) {
      parts.push('<div class="td-adopt-head">' + esc(t('section_title')) +
        ' <span class="td-adopt-badge">' + esc(t('badge')) + '</span></div>');
      parts.push('<div class="td-adopt-sub">' + esc(t('section_sub')) + '</div>');
      parts.push('<div class="td-adopt-grid">' + cards.map(c => cardHtml(c)).join('') + '</div>');
    } else if (surfState.imported) {
      parts.push('<div class="td-adopt-empty">' + esc(t('none_yet')) + '</div>');
    }

    container.innerHTML = parts.join('');
    // Wire action buttons (only present for Member+ via data-role-required).
    container.querySelectorAll('[data-adopt-action="open"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = cards.find(c => String(c.id) === btn.getAttribute('data-card-id'));
        if (card) openActions(surface, tenantId, card);
      });
    });
    applyI18n(container);
    if (window.Panoptica && Panoptica.applyRoleVisibility) Panoptica.applyRoleVisibility();
  }

  function cardHtml(c) {
    const inactive = c.lifecycle_state === 'deactivated';
    const drift = c.drift_status === 'drifted';
    const typeLabel = c.surface === 'intune' && c.policy_type ? c.policy_type : t('type_ca');
    let pills = '';
    pills += '<span class="td-adopt-pill ' + (inactive ? 'inactive' : 'active') + '">' +
      esc(inactive ? t('state_inactive') : t('state_active')) + '</span>';
    if (drift) {
      const reason = c.drift_details && c.drift_details.reason;
      const dk = reason === 'reenabled_externally' ? 'drift_reenabled'
        : (reason === 'removed' ? 'drift_removed' : 'drift_changed');
      pills += '<span class="td-adopt-pill drift">' + esc(t(dk)) + '</span>';
    }
    if (c.ms_managed) pills += '<span class="td-adopt-pill managed">' + esc(t('ms_managed')) + '</span>';
    return '<div class="td-adopt-card ' + (inactive ? 'inactive' : '') + '">' +
      '<div><span class="td-adopt-badge">' + esc(t('badge')) + '</span>' + pills + '</div>' +
      '<div class="td-adopt-name">' + esc(c.display_name) + '</div>' +
      '<div class="td-adopt-meta">' + esc(typeLabel) + '</div>' +
      '<button class="btn-secondary" data-role-required="member" data-adopt-action="open" data-card-id="' +
        esc(c.id) + '" style="font-size:0.78rem; padding:5px 10px;">' + esc(t('actions_btn')) + '</button>' +
      '</div>';
  }

  // ─── import button (always available; re-import is idempotent) ───
  function showImportButton(surface, tenantId) {
    const btn = document.getElementById('td-' + surface + '-import-btn');
    if (!btn) return;
    btn.style.display = '';
    btn.onclick = () => doImport(surface, tenantId, btn);
  }

  async function doImport(surface, tenantId, btn) {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = t('importing');
    try {
      const r = await api('/api/adopt/' + tenantId + '/import', {
        method: 'POST', body: JSON.stringify({ surface }),
      });
      if (r.status === 'success') {
        toast(t('import_success', { count: r.imported }), 'success');
      } else if (r.status === 'nothing_new') {
        toast(t('import_nothing_new'), 'info');
      } else if (r.status === 'empty') {
        toast(surface === 'ca' ? t('import_empty_ca') : t('import_empty_intune'), 'info');
      } else if (r.status === 'unlicensed') {
        toast(surface === 'ca' ? t('import_unlicensed_ca') : t('import_unlicensed_intune'), 'info');
      } else {
        toast(t('import_transient'), 'error');
      }
    } catch (e) {
      toast(t('import_transient'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
      load(tenantId, surface); // re-render (hides button on success/empty)
    }
  }

  // ─── action modal ───
  function modal(html) {
    const overlay = document.createElement('div');
    overlay.className = 'adopt-modal-overlay';
    overlay.innerHTML = '<div class="adopt-modal">' + html + '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(overlay); });
    applyI18n(overlay);
    // Render any <i data-lucide="..."> placeholders into SVG icons.
    if (window.Panoptica && Panoptica.refreshIcons) Panoptica.refreshIcons(overlay);
    return overlay;
  }
  function close(overlay) { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); }

  // One square icon tile in the action modal.
  function tile(act, icon, label, hint, danger) {
    return '<button class="adopt-tile' + (danger ? ' adopt-tile-danger' : '') + '" data-act="' + act + '">' +
      '<i data-lucide="' + icon + '"></i>' +
      '<span class="lbl">' + esc(label) + '</span>' +
      '<span class="hint">' + esc(hint) + '</span></button>';
  }

  function openActions(surface, tenantId, card) {
    const deactivated = card.lifecycle_state === 'deactivated';
    const name = esc(card.display_name);
    let body = '<h3>' + esc(t('actions_title')) + '</h3>' +
      '<div class="td-adopt-meta" style="margin-bottom:6px;">' + name + '</div>';

    // One row of square icon tiles: Stop monitoring · Deactivate/Restore · Delete.
    const middle = deactivated
      ? tile('restore', 'rotate-ccw', t('restore_btn'), t('hint_reversible'))
      : tile('deactivate', 'ban', t('tile_deactivate'), t('hint_reversible'));
    body += '<div class="adopt-tiles">' +
      tile('stop', 'eye-off', t('stop_btn'), t('hint_panoptica_only')) +
      middle +
      tile('delete', 'trash-2', t('tile_delete'), t('hint_permanent'), true) +
      '</div>';
    body += '<div class="adopt-footnote"><i data-lucide="info"></i><span>' + esc(t('stop_hint')) + '</span></div>';
    body += '<div class="adopt-cancel-row"><button class="btn-secondary" data-act="cancel">' + esc(t('cancel')) + '</button></div>';

    const overlay = modal(body);
    overlay.querySelectorAll('[data-act]').forEach(b => {
      b.addEventListener('click', () => {
        const act = b.getAttribute('data-act');
        if (act === 'cancel') return close(overlay);
        close(overlay);
        if (act === 'stop') confirmStop(surface, tenantId, card);
        else if (act === 'deactivate') confirmDeactivate(surface, tenantId, card);
        else if (act === 'restore') confirmRestore(surface, tenantId, card);
        else if (act === 'delete') confirmDelete(surface, tenantId, card);
      });
    });
  }

  // (1) Stop monitoring — lightest friction.
  function confirmStop(surface, tenantId, card) {
    const overlay = modal('<h3>' + esc(t('stop_title')) + '</h3>' +
      '<p style="font-size:0.86rem;">' + esc(t('stop_confirm', { name: card.display_name })) + '</p>' +
      '<div class="panoptica-only">' + esc(t('stop_hint')) + '</div>' +
      '<div class="actions"><button class="btn-secondary" data-x="c">' + esc(t('cancel')) + '</button>' +
      '<button class="btn-primary" data-x="ok">' + esc(t('stop_btn')) + '</button></div>');
    bindConfirm(overlay, () => post(surface, tenantId, '/api/adopt/card/' + card.id + '/stop-monitoring', null, t('stop_done')));
  }

  // (2) Deactivate — medium friction: "I understand" + keep-monitoring checkbox.
  function confirmDeactivate(surface, tenantId, card) {
    const overlay = modal('<h3>' + esc(t('deactivate_title')) + '</h3>' +
      '<div class="warn">' + esc(t('deactivate_warn', { name: card.display_name })) + '</div>' +
      '<label class="row"><input type="checkbox" id="adopt-monitor"> <span>' + esc(t('keep_monitoring')) + '</span></label>' +
      '<label class="row"><input type="checkbox" id="adopt-ack"> <span>' + esc(t('i_understand')) + '</span></label>' +
      '<div class="actions"><button class="btn-secondary" data-x="c">' + esc(t('cancel')) + '</button>' +
      '<button class="btn-primary" data-x="ok" disabled>' + esc(t('deactivate_btn')) + '</button></div>');
    const ack = overlay.querySelector('#adopt-ack');
    const okBtn = overlay.querySelector('[data-x="ok"]');
    ack.addEventListener('change', () => { okBtn.disabled = !ack.checked; });
    bindConfirm(overlay, () => {
      const monitor = overlay.querySelector('#adopt-monitor').checked;
      return post(surface, tenantId, '/api/adopt/card/' + card.id + '/deactivate',
        { acknowledge: true, monitor }, t('deactivate_done'));
    });
  }

  // (2b) Restore — light confirm.
  function confirmRestore(surface, tenantId, card) {
    const overlay = modal('<h3>' + esc(t('restore_title')) + '</h3>' +
      '<p style="font-size:0.86rem;">' + esc(t('restore_confirm', { name: card.display_name })) + '</p>' +
      '<div class="actions"><button class="btn-secondary" data-x="c">' + esc(t('cancel')) + '</button>' +
      '<button class="btn-primary" data-x="ok">' + esc(t('restore_btn')) + '</button></div>');
    bindConfirm(overlay, () => post(surface, tenantId, '/api/adopt/card/' + card.id + '/restore', {}, t('restore_done')));
  }

  // (3) Delete — heaviest friction: type your own name + "I understand".
  function confirmDelete(surface, tenantId, card) {
    const overlay = modal('<h3>' + esc(t('delete_title')) + '</h3>' +
      '<div class="warn">' + esc(t('delete_warn', { name: card.display_name })) + '</div>' +
      '<label style="font-size:0.84rem;">' + esc(t('type_your_name')) +
      '<input type="text" id="adopt-name" autocomplete="off"></label>' +
      '<label class="row"><input type="checkbox" id="adopt-ack"> <span>' + esc(t('i_understand_delete')) + '</span></label>' +
      '<div class="actions"><button class="btn-secondary" data-x="c">' + esc(t('cancel')) + '</button>' +
      '<button class="btn-danger" data-x="ok" disabled style="background:var(--p-danger,#d9534f);color:#fff;">' + esc(t('delete_btn')) + '</button></div>');
    const ack = overlay.querySelector('#adopt-ack');
    const nameEl = overlay.querySelector('#adopt-name');
    const okBtn = overlay.querySelector('[data-x="ok"]');
    function refresh() { okBtn.disabled = !(ack.checked && nameEl.value.trim().length > 0); }
    ack.addEventListener('change', refresh);
    nameEl.addEventListener('input', refresh);
    bindConfirm(overlay, async () => {
      try {
        const r = await api('/api/adopt/card/' + card.id + '/delete', {
          method: 'POST', body: JSON.stringify({ acknowledge: true, typed_name: nameEl.value.trim() }),
        });
        if (r && r.ok) { toast(t('delete_done'), 'success'); load(tenantId, surface); }
        else if (r && r.error === 'name_mismatch') toast(t('name_mismatch'), 'error');
        else if (r && r.reason === 'managed_by_microsoft') toast(t('managed_by_microsoft'), 'error');
        else toast(t('action_failed'), 'error');
      } catch (e) {
        toast(t('action_failed'), 'error');
      }
    }, true);
  }

  // Shared: wire cancel/ok; `manual` means the ok handler does its own toast/reload.
  function bindConfirm(overlay, okFn, manual) {
    overlay.querySelector('[data-x="c"]').addEventListener('click', () => close(overlay));
    overlay.querySelector('[data-x="ok"]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try { await okFn(); } finally { close(overlay); }
    });
  }

  async function post(surface, tenantId, path, body, doneMsg) {
    try {
      const r = await api(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      if (r && r.ok) { toast(doneMsg, 'success'); }
      else if (r && r.reason === 'managed_by_microsoft') { toast(t('managed_by_microsoft'), 'error'); }
      else { toast(t('action_failed'), 'error'); }
    } catch (e) {
      toast(t('action_failed'), 'error');
    } finally {
      load(tenantId, surface);
    }
  }

  window.Panoptica = window.Panoptica || {};
  window.Panoptica.Adopt = { load };
})();
