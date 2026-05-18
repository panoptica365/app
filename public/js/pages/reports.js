/**
 * Panoptica — Reports Page
 * Handles report generation UI, loading modal, and download management.
 */

(function () {
  'use strict';

  const reportHistory = []; // Session-scoped list of generated reports

  // ─── Stage management for the generation modal ───
  const STAGES = ['data', 'ca_policies', 'charts', 'ai', 'pdf'];

  function setStage(stageId) {
    STAGES.forEach(id => {
      const el = document.getElementById(`gen-stage-${id}`);
      if (!el) return;
      const indicator = el.querySelector('.stage-indicator');
      const idx = STAGES.indexOf(id);
      const activeIdx = STAGES.indexOf(stageId);

      if (idx < activeIdx) {
        el.classList.remove('active');
        el.classList.add('completed');
        indicator.classList.remove('active', 'pending');
        indicator.classList.add('done');
      } else if (idx === activeIdx) {
        el.classList.remove('completed');
        el.classList.add('active');
        indicator.classList.remove('pending', 'done');
        indicator.classList.add('active');
      } else {
        el.classList.remove('active', 'completed');
        indicator.classList.remove('active', 'done');
        indicator.classList.add('pending');
      }
    });
  }

  function showDone() {
    STAGES.forEach(id => {
      const el = document.getElementById(`gen-stage-${id}`);
      if (!el) return;
      el.classList.remove('active');
      el.classList.add('completed');
      const indicator = el.querySelector('.stage-indicator');
      indicator.classList.remove('active', 'pending');
      indicator.classList.add('done');
    });
    const doneEl = document.getElementById('gen-stage-done');
    if (doneEl) {
      doneEl.style.display = 'flex';
      doneEl.classList.add('completed');
    }
    // Stop the scanner
    const scanner = document.querySelector('.report-gen-scanner');
    if (scanner) scanner.style.display = 'none';
  }

  function resetStages() {
    STAGES.forEach(id => {
      const el = document.getElementById(`gen-stage-${id}`);
      if (!el) return;
      el.classList.remove('active', 'completed');
      const indicator = el.querySelector('.stage-indicator');
      indicator.classList.remove('active', 'done');
      indicator.classList.add('pending');
    });
    const doneEl = document.getElementById('gen-stage-done');
    if (doneEl) {
      doneEl.style.display = 'none';
      doneEl.classList.remove('completed');
    }
    const scanner = document.querySelector('.report-gen-scanner');
    if (scanner) scanner.style.display = '';
  }

  function showGenModal(tenantName, range) {
    resetStages();
    const overlay = document.getElementById('report-gen-overlay');
    const infoText = document.getElementById('gen-info-text');
    if (infoText) {
      const rangeLabels = {
        '7d': window.t('reports.range.last_7_days'),
        '30d': window.t('reports.range.last_30_days'),
        '90d': window.t('reports.range.last_90_days'),
      };
      infoText.textContent = `${tenantName} — ${rangeLabels[range] || range}`;
    }
    if (overlay) overlay.classList.add('active');
  }

  function hideGenModal() {
    const overlay = document.getElementById('report-gen-overlay');
    if (overlay) overlay.classList.remove('active');
  }

  // ─── Report history rendering ───
  function renderHistory() {
    const container = document.getElementById('report-history');
    if (!container) return;

    if (reportHistory.length === 0) {
      container.innerHTML = `<span style="color: var(--p-text-muted);">${window.t('reports.history.empty')}</span>`;
      return;
    }

    container.innerHTML = reportHistory.map(r => {
      const icon = r.type === 'security-posture' ? '&#128196;' : '&#128203;';
      const typeLabel = r.type === 'security-posture' ? window.t('reports.history.type_security_posture')
        : r.type === 'data-export' ? window.t('reports.history.type_data_export')
        : window.t('reports.history.type_json_export');
      return `
        <div class="report-history-item">
          <span class="rh-icon">${icon}</span>
          <div class="rh-info">
            <div class="rh-name">${r.tenantName} — ${typeLabel}</div>
            <div class="rh-meta">${r.range} &middot; ${window.t('reports.history.generated_at', { time: r.time })}</div>
          </div>
          <a href="${r.url}" download class="rh-download">${window.t('reports.btn_download')}</a>
        </div>`;
    }).join('');
  }

  // ─── Generate report ───
  async function generate() {
    const tenantSelect = document.getElementById('report-tenant');
    const typeSelect = document.getElementById('report-type');
    const rangeSelect = document.getElementById('report-range');
    const btn = document.getElementById('report-generate-btn');

    const tenantId = tenantSelect.value;
    const tenantName = tenantSelect.options[tenantSelect.selectedIndex]?.text || window.t('reports.tenant_unknown');
    const reportType = typeSelect.value;
    const range = rangeSelect.value;

    if (!tenantId) {
      Panoptica.showToast(window.t('reports.toast_select_tenant'), 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = window.t('reports.btn_generating');

    try {
      if (reportType === 'data-export') {
        // Data Export — full snapshot bundle, streamed as ZIP. No range
        // (snapshot is current state, not time-windowed). No modal needed —
        // the request is a single round-trip; download dialog is feedback.
        const response = await fetch(`/api/reports/data-export?tenant_id=${tenantId}`);
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: window.t('reports.error_download_failed') }));
          throw new Error(err.error || err.message || window.t('reports.error_download_failed'));
        }
        const blob = await response.blob();

        // Pull filename from Content-Disposition if present, else generate one.
        const cd = response.headers.get('content-disposition') || '';
        const fnMatch = cd.match(/filename="?([^"]+)"?/);
        const filename = fnMatch ? fnMatch[1]
          : `panoptica-snapshot-${tenantName.replace(/[^a-zA-Z0-9]+/g, '_')}.zip`;

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        reportHistory.unshift({
          type: 'data-export',
          tenantName,
          range: 'snapshot',
          time: new Date().toLocaleTimeString(),
          url: '#',
        });
        renderHistory();
        Panoptica.showToast(window.t('reports.toast_data_downloaded'), 'success');

      } else if (reportType === 'json-export') {
        // Legacy JSON export (Custodia Menses integration). Hidden from the
        // dropdown but kept reachable in case any external tooling still
        // calls it via direct URL or hand-set the report-type value.
        const response = await fetch(`/api/reports/json-export?tenant_id=${tenantId}&range=${range}`);
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: window.t('reports.error_download_failed') }));
          throw new Error(err.error || window.t('reports.error_download_failed'));
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${tenantName.replace(/[^a-zA-Z0-9]/g, '_')}_${range}_export.json`;
        a.click();
        URL.revokeObjectURL(url);

        reportHistory.unshift({
          type: 'json-export',
          tenantName,
          range,
          time: new Date().toLocaleTimeString(),
          url: '#',
        });
        renderHistory();
        Panoptica.showToast(window.t('reports.toast_json_downloaded'), 'success');

      } else if (reportType === 'documentation') {
        // Configuration Documentation PDF — same SSE pattern as Security Posture.
        // No range param — always operates on current-state snapshot.
        // Backend emits stages: data → previous → pdf → store → done.
        showGenModal(tenantName, '');
        setStage('data');

        const response = await fetch('/api/reports/documentation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant_id: parseInt(tenantId, 10) }),
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: window.t('reports.error_generation_failed') }));
          throw new Error(err.error || window.t('reports.error_generation_failed'));
        }

        // Map backend stage names → existing modal stage ids:
        //   data → data, previous → ca_policies, pdf → pdf, store → pdf
        const stageMap = { data: 'data', previous: 'ca_policies', pdf: 'pdf', store: 'pdf' };
        let pdfUrl = null;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          for (const line of text.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const msg = JSON.parse(line.substring(6));
              if (msg.stage) setStage(stageMap[msg.stage] || msg.stage);
              if (msg.done) { showDone(); pdfUrl = msg.url; }
              if (msg.error) throw new Error(msg.error);
            } catch (e) {
              if (e.message && !e.message.includes('JSON')) throw e;
            }
          }
        }
        if (pdfUrl) {
          await new Promise(r => setTimeout(r, 1200));
          hideGenModal();
          const a = document.createElement('a');
          a.href = pdfUrl;
          a.download = `${tenantName.replace(/[^a-zA-Z0-9]/g, '_')}_Documentation.pdf`;
          a.click();
          reportHistory.unshift({
            type: 'documentation',
            tenantName,
            range: 'snapshot',
            time: new Date().toLocaleTimeString(),
            url: pdfUrl,
          });
          renderHistory();
          Panoptica.showToast(window.t('reports.toast_documentation_generated'), 'success');
        }

      } else {
        // Security Posture PDF — show generation modal with progress stages
        showGenModal(tenantName, range);

        // Simulate stage progression via SSE or polling
        // We use a single POST that returns progress via event-stream
        setStage('data');

        const response = await fetch('/api/reports/security-posture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant_id: parseInt(tenantId, 10), range }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: window.t('reports.error_generation_failed') }));
          throw new Error(err.error || window.t('reports.error_generation_failed'));
        }

        // Check if it's a streaming response
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
          // Read SSE stream for stage updates
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let pdfUrl = null;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const msg = JSON.parse(line.substring(6));
                  if (msg.stage) setStage(msg.stage);
                  if (msg.done) {
                    showDone();
                    pdfUrl = msg.url;
                  }
                  if (msg.error) throw new Error(msg.error);
                } catch (e) {
                  if (e.message && !e.message.includes('JSON')) throw e;
                }
              }
            }
          }

          if (pdfUrl) {
            // Brief pause to show the "done" state
            await new Promise(r => setTimeout(r, 1200));
            hideGenModal();

            // Trigger download
            const a = document.createElement('a');
            a.href = pdfUrl;
            a.download = `${tenantName.replace(/[^a-zA-Z0-9]/g, '_')}_Security_Posture_${range}.pdf`;
            a.click();

            reportHistory.unshift({
              type: 'security-posture',
              tenantName,
              range,
              time: new Date().toLocaleTimeString(),
              url: pdfUrl,
            });
            renderHistory();
            Panoptica.showToast(window.t('reports.toast_security_generated'), 'success');
          }

        } else {
          // Fallback: non-streaming — just download the blob
          // Fast-forward stages for visual feedback
          setStage('ca_policies');
          await new Promise(r => setTimeout(r, 300));
          setStage('charts');
          await new Promise(r => setTimeout(r, 300));
          setStage('ai');
          await new Promise(r => setTimeout(r, 300));
          setStage('pdf');
          await new Promise(r => setTimeout(r, 300));

          const blob = await response.blob();
          showDone();
          await new Promise(r => setTimeout(r, 1000));
          hideGenModal();

          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${tenantName.replace(/[^a-zA-Z0-9]/g, '_')}_Security_Posture_${range}.pdf`;
          a.click();
          URL.revokeObjectURL(url);

          reportHistory.unshift({
            type: 'security-posture',
            tenantName,
            range,
            time: new Date().toLocaleTimeString(),
            url: '#',
          });
          renderHistory();
          Panoptica.showToast(window.t('reports.toast_security_generated'), 'success');
        }
      }
    } catch (err) {
      hideGenModal();
      console.error('[Reports] Generation failed:', err);
      Panoptica.showToast(err.message || window.t('reports.toast_generation_failed'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = window.t('reports.btn_generate');
    }
  }

  // ─── Init ───
  async function init() {
    // Load tenant list
    try {
      const tenants = await Panoptica.api('/api/tenants');
      const select = document.getElementById('report-tenant');
      if (select) {
        select.innerHTML = `<option value="">${window.t('reports.option_select_tenant')}</option>` +
          tenants.map(t => `<option value="${t.id}">${t.display_name}</option>`).join('');
      }
    } catch (err) {
      console.error('[Reports] Failed to load tenants:', err);
    }

    // Button handler
    const btn = document.getElementById('report-generate-btn');
    if (btn) btn.addEventListener('click', generate);

    // Update modal stage labels + gray out the Time Range select when the
    // selected report type doesn't use a time window (Data Export is a
    // current-state snapshot, range-irrelevant).
    const typeSelect = document.getElementById('report-type');
    const rangeSelect = document.getElementById('report-range');
    if (typeSelect) {
      const onTypeChange = () => {
        const dataStage = document.getElementById('gen-stage-data');
        const caStage = document.getElementById('gen-stage-ca_policies');
        const chartsStage = document.getElementById('gen-stage-charts');
        const aiStage = document.getElementById('gen-stage-ai');
        const pdfStage = document.getElementById('gen-stage-pdf');
        if (typeSelect.value === 'json-export') {
          if (aiStage) aiStage.querySelector('.stage-label').textContent = window.t('reports.stage.packaging_data');
          if (pdfStage) pdfStage.querySelector('.stage-label').textContent = window.t('reports.stage.creating_json');
        } else if (typeSelect.value === 'documentation') {
          // Documentation has its own 4-stage flow: data → previous → pdf → store.
          // Reuse the existing 5-stage modal, hiding charts + ai which don't apply.
          if (dataStage) dataStage.querySelector('.stage-label').textContent = window.t('reports.stage.gathering_config');
          if (caStage) caStage.querySelector('.stage-label').textContent = window.t('reports.stage.previous_snapshot');
          if (chartsStage) chartsStage.style.display = 'none';
          if (aiStage) aiStage.style.display = 'none';
          if (pdfStage) pdfStage.querySelector('.stage-label').textContent = window.t('reports.stage.assembling');
        } else if (typeSelect.value !== 'data-export') {
          // Restore charts + ai if they were hidden by an earlier documentation pick.
          if (chartsStage) chartsStage.style.display = '';
          if (aiStage) {
            aiStage.style.display = '';
            aiStage.querySelector('.stage-label').textContent = window.t('reports.stage.sonnet_analyzing');
          }
          if (caStage) caStage.querySelector('.stage-label').textContent = window.t('reports.gen_stage_ca');
          if (dataStage) dataStage.querySelector('.stage-label').textContent = window.t('reports.gen_stage_data');
          if (pdfStage) pdfStage.querySelector('.stage-label').textContent = window.t('reports.stage.assembling');
        }
        // Time range applies to security-posture + json-export only. Data Export
        // and Documentation are current-state snapshots — no range.
        if (rangeSelect) {
          const rangeIrrelevant = (typeSelect.value === 'data-export' || typeSelect.value === 'documentation');
          rangeSelect.disabled = rangeIrrelevant;
          rangeSelect.style.opacity = rangeIrrelevant ? '0.45' : '1';
          rangeSelect.title = rangeIrrelevant
            ? window.t('reports.tooltip_data_export_no_range')
            : '';
        }
      };
      typeSelect.addEventListener('change', onTypeChange);
      // Apply once on init in case the page was reloaded with data-export
      // already chosen (browser autofill etc.).
      onTypeChange();
    }

    renderHistory();
  }

  function destroy() {
    // Nothing to clean up
  }

  window.PanopticaPage = { init, destroy, generate };
})();
