/**
 * Panoptica365 — PSA resolve-ticket modal (Feature 8.3)
 *
 * Shared helper for the resolve flow. Given the alert id(s) about to be
 * resolved, it asks the server which have an OPEN linked Autotask ticket. If
 * none, it resolves silently (no modal). If one or more, it shows a single
 * modal — "Also close the ticket?" — and returns the operator's choice. The
 * bulk variant asks ONCE and applies the choice to every affected ticket
 * (decision 5 / §8.3).
 *
 * Exposed as Panoptica.PsaResolveModal.maybeConfirm({ alertIds }) →
 *   Promise<{ proceed: boolean, closeTicket: boolean }>
 *   - proceed=false only when the operator cancels the modal.
 *   - When no linked tickets exist, resolves { proceed:true, closeTicket:false }.
 */
(function () {
  'use strict';

  function t(key, params) {
    return (window.t ? window.t(key, params) : key);
  }

  async function fetchOpenLinks(alertIds) {
    try {
      const r = await Panoptica.api('/api/alerts/psa-links', {
        method: 'POST',
        body: JSON.stringify({ alert_ids: alertIds }),
      });
      return (r && r.links) || {};
    } catch (_) {
      return {}; // PSA off or lookup failed → behave as "no linked tickets"
    }
  }

  function showModal(linkCount, firstTicketNumber) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'psa-modal-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;';

      const body = linkCount > 1
        ? t('psa.modal.body_bulk', { count: linkCount })
        : t('psa.modal.body_single', { ticket: firstTicketNumber || '' });

      const card = document.createElement('div');
      card.style.cssText = 'background:var(--p-surface,#16162a);border:1px solid rgba(255,255,255,0.22);border-radius:10px;max-width:480px;width:90%;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,0.5);';
      card.innerHTML = `
        <div style="font-family:Inter,sans-serif;font-size:1.1rem;color:var(--p-text,#e0e0e0);margin-bottom:10px;">${escHtml(t('psa.modal.title'))}</div>
        <div style="font-family:Inter,sans-serif;font-size:0.9rem;color:var(--p-text-muted,#aaa);line-height:1.5;margin-bottom:20px;">${escHtml(body)}</div>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          <button class="btn-secondary" data-act="cancel">${escHtml(t('common.cancel') || 'Cancel')}</button>
          <button class="btn-secondary" data-act="leave">${escHtml(t('psa.modal.leave_open_btn'))}</button>
          <button class="btn-primary" data-act="close">${escHtml(t('psa.modal.close_btn'))}</button>
        </div>`;
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      const done = (result) => {
        overlay.remove();
        resolve(result);
      };
      card.querySelector('[data-act="cancel"]').addEventListener('click', () => done({ proceed: false, closeTicket: false }));
      card.querySelector('[data-act="leave"]').addEventListener('click', () => done({ proceed: true, closeTicket: false }));
      card.querySelector('[data-act="close"]').addEventListener('click', () => done({ proceed: true, closeTicket: true }));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done({ proceed: false, closeTicket: false }); });
    });
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }

  /**
   * @param {object} opts { alertIds:number[] }
   * @returns {Promise<{proceed:boolean, closeTicket:boolean}>}
   */
  async function maybeConfirm(opts) {
    const alertIds = (opts && opts.alertIds || []).map(Number).filter(Number.isFinite);
    if (alertIds.length === 0) return { proceed: true, closeTicket: false };
    const links = await fetchOpenLinks(alertIds);
    const keys = Object.keys(links);
    if (keys.length === 0) return { proceed: true, closeTicket: false };
    const first = links[keys[0]];
    return showModal(keys.length, first && first.ticket_number);
  }

  window.Panoptica = window.Panoptica || {};
  window.Panoptica.PsaResolveModal = { maybeConfirm };
})();
