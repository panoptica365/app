/**
 * Panoptica — Main Console Page Module
 * Secure Score gauges (avg + high/low), tenant list, Claude daily briefing + Ask Claude chat.
 */

(function () {
  'use strict';

  let gaugeChart = null;
  let highChart = null;
  let lowChart = null;
  let refreshInterval = null;
  let chatBusy = false;
  let chatSessionId = null;

  // v0.1.17 tenant filter — cache the last fetched tenant list so the filter
  // input can re-render a subset without re-fetching. `tenantListMode` tracks
  // whether we have scored data (from /scores/secure) or basic data (from
  // /tenants) so applyTenantFilter() dispatches to the right renderer.
  let cachedTenants = [];
  let tenantListMode = 'scored'; // 'scored' | 'basic'

  // Alert bar chart
  let alertBarChart = null;
  // DB uses 'severe' but we display 'Critical' to the user
  const SEVERITY_KEYS = ['severe', 'high', 'medium', 'low', 'info'];
  const SEVERITY_LABELS = ['Critical', 'High', 'Medium', 'Low', 'Info'];
  const SEVERITY_COLORS = ['#cc4444', '#ff9900', '#ffcc66', '#6688cc', '#9999cc'];

  async function init() {
    await loadData();
    loadBriefing();
    loadAlertBarChart();
    wireChat();
    wireAlertGaugeFilter();
    wireTenantFilter();
    // Auto-refresh every 5 minutes
    refreshInterval = setInterval(() => {
      loadData();
      loadAlertBarChart();
    }, 5 * 60 * 1000);
  }

  function destroy() {
    if (gaugeChart) { gaugeChart.destroy(); gaugeChart = null; }
    if (highChart)  { highChart.destroy();  highChart = null; }
    if (lowChart)   { lowChart.destroy();   lowChart = null; }
    if (alertBarChart) { alertBarChart.destroy(); alertBarChart = null; }
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    chatBusy = false;
    chatSessionId = null;
  }

  async function loadData() {
    try {
      const data = await Panoptica.api('/api/tenants/scores/secure');
      renderGauge(data.average);
      renderHighLow(data.tenants);
      renderTenantList(data.tenants);
      // Push avg to bottom status bar (computed here so we don't re-fetch)
      if (typeof Panoptica.setStatus === 'function') {
        Panoptica.setStatus('secureScore', data.average != null ? `${data.average}%` : null);
      }
    } catch (err) {
      console.error('[MainConsole] Load failed:', err);
      try {
        const tenants = await Panoptica.api('/api/tenants');
        renderTenantListBasic(tenants);
        renderGauge(null);
      } catch (e2) {
        document.getElementById('tenant-list-body').innerHTML =
          '<div class="panel-error">Failed to load tenant data.</div>';
      }
    }
  }

  function createDoughnut(canvas, percentage, color, cutout) {
    const ctx = canvas.getContext('2d');
    // May 9, 2026 — read theme token at create time so the gauge's "rest"
    // segment tracks light/dark theme. Was hardcoded `rgba(51, 68, 119, 0.2)`
    // (a dark-bluish translucent), which printed as harsh navy under the
    // light theme. Same fix pattern as daily-activity donuts (Apr 28).
    const cssVar = (name, fallback) => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    };
    const trackColor = cssVar('--p-border-subtle', 'rgba(51, 68, 119, 0.2)');
    return new Chart(ctx, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [percentage, 100 - percentage],
          backgroundColor: [color, trackColor],
          borderWidth: 0,
          circumference: 240,
          rotation: 240,
        }],
      },
      options: {
        responsive: false,
        cutout: cutout || '78%',
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    });
  }

  function scoreColor(pct) {
    if (pct >= 70) return '#33CC66';
    if (pct >= 45) return '#FFAA00';
    return '#FF3232';
  }

  function renderGauge(percentage) {
    const canvas = document.getElementById('secure-score-gauge');
    const valueEl = document.getElementById('secure-score-value');
    if (!canvas) return;

    if (percentage == null) { valueEl.textContent = '—'; return; }

    valueEl.textContent = fmtPct(percentage);
    if (gaugeChart) gaugeChart.destroy();
    gaugeChart = createDoughnut(canvas, percentage, scoreColor(percentage));
  }

  function renderHighLow(tenants) {
    // Filter to MANAGED tenants with valid scores. Audit-only tenants are
    // excluded from the cross-tenant Secure Score gauges (highest/lowest)
    // because their scores reflect prospect baselines, not managed-customer
    // posture. The tenant list below the gauges still shows them so the
    // operator can navigate to their dashboard during the audit window.
    // Server-side average (data.average) is already filtered the same way.
    const scored = tenants.filter(t =>
      t.score?.percentage != null && t.mode === 'managed'
    );
    if (scored.length === 0) return;

    // Sort to find highest and lowest
    scored.sort((a, b) => b.score.percentage - a.score.percentage);
    const highest = scored[0];
    const lowest = scored[scored.length - 1];

    // High gauge
    const highCanvas = document.getElementById('score-high-gauge');
    const highValue = document.getElementById('score-high-value');
    const highName = document.getElementById('score-high-name');
    if (highCanvas) {
      highValue.textContent = fmtPct(highest.score.percentage);
      highName.textContent = highest.display_name;
      if (highChart) highChart.destroy();
      highChart = createDoughnut(highCanvas, highest.score.percentage, '#33CC66', '75%');
    }

    // Low gauge
    const lowCanvas = document.getElementById('score-low-gauge');
    const lowValue = document.getElementById('score-low-value');
    const lowName = document.getElementById('score-low-name');
    if (lowCanvas) {
      lowValue.textContent = fmtPct(lowest.score.percentage);
      lowName.textContent = lowest.display_name;
      if (lowChart) lowChart.destroy();
      const lowColor = scoreColor(lowest.score.percentage);
      lowChart = createDoughnut(lowCanvas, lowest.score.percentage, lowColor, '75%');
    }
  }

  // v0.1.17: renderTenantList() and renderTenantListBasic() now cache the
  // full tenant list and delegate to applyTenantFilter(), which re-reads the
  // filter input and dispatches to the matching internal renderer with the
  // filtered subset. Lets the 5-minute auto-refresh land fresh data without
  // clobbering the operator's in-progress filter.

  function renderTenantList(tenants) {
    // Sort once at cache time so applyTenantFilter() doesn't re-sort on
    // every keystroke.
    tenants.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
    cachedTenants = tenants;
    tenantListMode = 'scored';
    applyTenantFilter();
  }

  function renderTenantListBasic(tenants) {
    cachedTenants = tenants;
    tenantListMode = 'basic';
    applyTenantFilter();
  }

  function applyTenantFilter() {
    const input = document.getElementById('tenant-filter-input');
    const q = (input?.value || '').trim().toLowerCase();
    const filtered = q
      ? cachedTenants.filter(t => (t.display_name || '').toLowerCase().includes(q))
      : cachedTenants;

    // Clear-button visibility tracks whether there's anything to clear.
    const clear = document.getElementById('tenant-filter-clear');
    if (clear) clear.style.display = q ? 'inline-flex' : 'none';

    if (tenantListMode === 'scored') {
      doRenderTenantListScored(filtered, cachedTenants.length, q);
    } else {
      doRenderTenantListBasic(filtered, cachedTenants.length, q);
    }
  }

  function updateCountLabel(shown, total, isFiltering) {
    const countEl = document.getElementById('tenant-count');
    if (!countEl) return;
    if (isFiltering) {
      countEl.textContent = `${shown} of ${total} tenant${total !== 1 ? 's' : ''}`;
    } else {
      countEl.textContent = `${total} tenant${total !== 1 ? 's' : ''}`;
    }
  }

  function renderEmptyTenantBody(isFiltering) {
    const body = document.getElementById('tenant-list-body');
    if (!body) return;
    // Localized inline (dynamic innerHTML doesn't auto-translate). These are
    // the first-run empty states a fresh-install MSP sees, so they must honor
    // the active locale.
    const msg = isFiltering
      ? window.t('main_console.no_tenants_filter')
      : window.t('main_console.no_tenants_configured');
    body.innerHTML = `<div style="color:var(--p-text-muted); padding:20px; font-family:Inter,sans-serif;">${escHtml(msg)}</div>`;
  }

  function wireTenantRowClicks(body) {
    body.querySelectorAll('.tenant-row').forEach(row => {
      row.addEventListener('click', () => {
        Panoptica.openTenantDashboard(row.dataset.tenantId, row.dataset.tenantName);
      });
    });
  }

  function doRenderTenantListScored(tenants, total, q) {
    const body = document.getElementById('tenant-list-body');
    if (!body) return;
    const isFiltering = q.length > 0;
    updateCountLabel(tenants.length, total, isFiltering);

    if (tenants.length === 0) {
      renderEmptyTenantBody(isFiltering);
      return;
    }

    let html = `<table class="tenant-list-table">
      <thead><tr>
        <th>Tenant</th>
        <th>Secure Score</th>
        <th>Status</th>
        <th>Last Polled</th>
      </tr></thead><tbody>`;

    for (const t of tenants) {
      const score = t.score?.percentage;
      const scoreClass = score >= 70 ? 'score-green' : score >= 45 ? 'score-yellow' : score != null ? 'score-red' : '';
      const scoreText = score != null ? fmtPct(score) : '—';

      html += `<tr data-tenant-id="${t.tenant_db_id}" data-tenant-name="${escHtml(t.display_name)}" class="tenant-row">
        <td class="tenant-name">${escHtml(t.display_name)}</td>
        <td><span class="tenant-score ${scoreClass}">${scoreText}</span></td>
        <td>${t.error
          ? '<span class="status-badge status-disabled">Error</span>'
          : '<span class="status-badge status-enabled">Active</span>'
        }</td>
        <td class="mono">${t.last_polled_at || '—'}</td>
      </tr>`;
    }

    html += '</tbody></table>';
    body.innerHTML = html;
    wireTenantRowClicks(body);
  }

  function doRenderTenantListBasic(tenants, total, q) {
    const body = document.getElementById('tenant-list-body');
    if (!body) return;
    const isFiltering = q.length > 0;
    updateCountLabel(tenants.length, total, isFiltering);

    if (tenants.length === 0) {
      renderEmptyTenantBody(isFiltering);
      return;
    }

    let html = `<table class="tenant-list-table">
      <thead><tr>
        <th>Tenant</th>
        <th>Status</th>
        <th>Language</th>
        <th>Last Polled</th>
      </tr></thead><tbody>`;

    for (const t of tenants) {
      const statusClass = t.enabled ? 'status-enabled' : 'status-disabled';
      const statusText = t.enabled ? 'Enabled' : 'Disabled';

      html += `<tr data-tenant-id="${t.id}" data-tenant-name="${escHtml(t.display_name)}" class="tenant-row">
        <td class="tenant-name">${escHtml(t.display_name)}</td>
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        <td>${(t.language || 'en').toUpperCase()}</td>
        <td class="mono">${t.last_polled_at || '—'}</td>
      </tr>`;
    }

    html += '</tbody></table>';
    body.innerHTML = html;
    wireTenantRowClicks(body);
  }

  function wireTenantFilter() {
    const input = document.getElementById('tenant-filter-input');
    const clear = document.getElementById('tenant-filter-clear');
    if (!input) return;
    input.addEventListener('input', applyTenantFilter);
    if (clear) {
      clear.addEventListener('click', () => {
        input.value = '';
        applyTenantFilter();
        input.focus();
      });
    }
    // Esc clears the filter when the input has focus
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) {
        e.preventDefault();
        input.value = '';
        applyTenantFilter();
      }
    });
  }

  // ─── Briefing Widget ───

  async function loadBriefing() {
    const contentEl = document.getElementById('briefing-content');
    const tsEl = document.getElementById('briefing-timestamp');
    if (!contentEl) return;

    try {
      // Phase 8 (May 2, 2026): briefings stored in 3 locales. Pass current
      // operator language; server picks the matching column or falls back
      // to en. Add `?lang=` so the dashboard widget shows the right text.
      const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
      const data = await Panoptica.api('/api/ai/briefing?lang=' + encodeURIComponent(lang));

      if (!data.available) {
        // Ignore the backend's English `message` — render a localized empty
        // state instead (operator-facing copy lives in the locale layer, not
        // the backend). available:false is the only signal we need.
        contentEl.innerHTML = `<div class="briefing-placeholder">${escHtml(window.t('main_console.briefing_none_yet'))}</div>`;
        return;
      }

      // Render markdown to HTML using the shared converter
      const html = Panoptica.mdToHtml(data.summary);
      contentEl.innerHTML = `<div class="briefing-text">${html}</div>`;

      if (tsEl && data.generatedAt) {
        const dt = new Date(data.generatedAt);
        const dateLocale = lang === 'fr' ? 'fr-CA' : (lang === 'es' ? 'es' : 'en-CA');
        tsEl.textContent = dt.toLocaleString(dateLocale, {
          timeZone: 'America/Toronto',
          month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });
      }
    } catch (err) {
      console.error('[MainConsole] Briefing load failed:', err);
      contentEl.innerHTML = `<div class="briefing-placeholder">${escHtml(window.t('main_console.briefing_unavailable'))}</div>`;
    }
  }

  // ─── Ask Claude Chat ───

  function wireChat() {
    const input = document.getElementById('main-chat-input');
    const btn = document.getElementById('main-chat-send');
    const newBtn = document.getElementById('main-chat-new');
    if (!input || !btn) return;

    btn.addEventListener('click', () => sendChat());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });
    if (newBtn) newBtn.addEventListener('click', () => resetChat('main'));
  }

  async function sendChat() {
    if (chatBusy) return;

    const input = document.getElementById('main-chat-input');
    const thread = document.getElementById('main-chat-thread');
    const newBtn = document.getElementById('main-chat-new');
    const question = input.value.trim();
    if (!question) return;

    chatBusy = true;
    const btn = document.getElementById('main-chat-send');
    btn.disabled = true;
    btn.textContent = '...';

    // Show thread and append user message
    thread.style.display = 'block';
    appendToThread(thread, 'user', question);
    const thinkingEl = appendToThread(thread, 'thinking', 'Claude is thinking...');
    input.value = '';

    try {
      // Phase 8d: include operator's current language so Claude responds
      // in their locale. Server prompt threads `lang` into a directive.
      const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
      const payload = { question, lang };
      if (chatSessionId) payload.sessionId = chatSessionId;

      const data = await Panoptica.api('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // Remove thinking indicator and show answer
      thinkingEl.remove();
      appendToThread(thread, 'assistant', data.answer);
      chatSessionId = data.sessionId;

      // Show New Conversation button after first exchange
      if (newBtn) newBtn.style.display = '';

      // Handle expired session
      if (data.expired) {
        chatSessionId = null;
        if (newBtn) newBtn.style.display = '';
      }
    } catch (err) {
      thinkingEl.remove();
      appendToThread(thread, 'error', err.message || 'Unknown error');
    } finally {
      chatBusy = false;
      btn.disabled = false;
      btn.textContent = 'Ask';
    }
  }

  function resetChat(prefix) {
    const thread = document.getElementById(prefix + '-chat-thread');
    const newBtn = document.getElementById(prefix + '-chat-new');
    if (thread) { thread.innerHTML = ''; thread.style.display = 'none'; }
    if (newBtn) newBtn.style.display = 'none';
    chatSessionId = null;
  }

  function appendToThread(thread, role, text) {
    const div = document.createElement('div');
    if (role === 'user') {
      div.className = 'chat-bubble chat-bubble-user';
      div.innerHTML = '<span class="chat-bubble-label">You</span>' + escHtml(text);
    } else if (role === 'assistant') {
      div.className = 'chat-bubble chat-bubble-assistant';
      div.innerHTML = '<span class="chat-bubble-label">Claude</span>' + Panoptica.mdToHtml(text);
    } else if (role === 'thinking') {
      div.className = 'chat-bubble chat-bubble-thinking';
      div.innerHTML = '<span class="chat-loading">' + escHtml(text) + '</span>';
    } else if (role === 'error') {
      div.className = 'chat-bubble chat-bubble-error';
      div.innerHTML = '<span class="chat-error">Error: ' + escHtml(text) + '</span>';
    }
    thread.appendChild(div);
    thread.scrollTop = thread.scrollHeight;
    return div;
  }

  // ─── Alert Severity Bar Chart ───

  function wireAlertGaugeFilter() {
    const sel = document.getElementById('alert-gauge-range');
    if (sel) sel.addEventListener('change', () => loadAlertBarChart());
  }

  async function loadAlertBarChart() {
    try {
      const range = document.getElementById('alert-gauge-range')?.value || 'open';
      const data = await Panoptica.api(`/api/alerts/stats?range=${range}`);
      const counts = data.bySeverity || {};
      renderAlertBarChart(counts);
    } catch (err) {
      console.error('[MainConsole] Alert bar chart load failed:', err);
    }
  }

  function renderAlertBarChart(counts) {
    const canvas = document.getElementById('alert-bar-chart');
    if (!canvas) return;

    const values = SEVERITY_KEYS.map(k => counts[k] || 0);

    if (alertBarChart) alertBarChart.destroy();

    // May 9, 2026 — read theme tokens at chart-create time for tooltip,
    // grid lines, and Y-axis tick text. Was hardcoded dark values that
    // looked like a foreign overlay on the light theme. Same pattern as
    // daily-activity donut (feedback_chartjs_canvas_tooltip.md).
    const cssVar = (name, fallback) => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    };
    const tipBg     = cssVar('--p-surface-deep', 'rgba(10, 10, 30, 0.9)');
    const tipText   = cssVar('--p-text', '#ffffff');
    const tipBorder = cssVar('--p-border', 'rgba(0, 0, 0, 0.4)');
    const gridColor = cssVar('--p-border-subtle', 'rgba(51, 68, 119, 0.15)');
    const tickColor = cssVar('--p-text-muted', '#667799');

    alertBarChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: SEVERITY_LABELS,
        datasets: [{
          data: values,
          backgroundColor: SEVERITY_COLORS,
          borderWidth: 0,
          borderRadius: 4,
          barPercentage: 0.6,
          categoryPercentage: 0.7,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: tipBg,
            titleColor: tipText,
            bodyColor: tipText,
            borderColor: tipBorder,
            borderWidth: 1,
            titleFont: { family: 'Inter' },
            bodyFont: { family: 'Inter' },
            caretSize: 0,
            displayColors: false,
            callbacks: {
              label: function(ctx) { return ctx.parsed.y + ' alert' + (ctx.parsed.y !== 1 ? 's' : ''); }
            }
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: function(ctx) { return SEVERITY_COLORS[ctx.index] || tickColor; },
              font: { family: 'Inter', size: 12, weight: '600' },
            },
            border: { display: false },
          },
          y: {
            beginAtZero: true,
            grid: { color: gridColor, lineWidth: 1 },
            ticks: {
              color: tickColor,
              font: { family: 'Inter', size: 11 },
              stepSize: 1,
              precision: 0,
            },
            border: { display: false },
          }
        },
      }
    });
  }

  function fmtPct(val) {
    return Number(val).toFixed(2) + '%';
  }

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  window.PanopticaPage = { init, destroy };
})();
