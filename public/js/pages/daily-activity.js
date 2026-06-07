/**
 * Panoptica — Daily Activity Page Module (Phase 8, 2026-04-09)
 *
 * Renders two donut charts using data from /api/daily-activity:
 *   - Login Failures — per-tenant failed sign-in counts for today
 *   - CA Blocks      — per-tenant Conditional Access block counts for today
 *
 * Each segment's size = today's raw count for the tenant.
 * Each segment's color = deviation from the tenant's 7-day rolling average
 * (computed server-side — see src/routes/api-daily-activity.js).
 *
 * Click on a tenant legend row to drill into that tenant's dashboard.
 */

(function () {
  'use strict';

  let loginFailuresChart = null;
  let caBlocksChart = null;
  let refreshInterval = null;

  // Widget → DOM ids map, so we can add more donuts later without touching logic.
  const WIDGETS = [
    {
      key: 'login_failures',
      canvasId: 'login-failures-donut',
      totalId: 'login-failures-total',
      subtitleId: 'login-failures-subtitle',
      legendId: 'login-failures-legend',
    },
    {
      key: 'ca_blocks',
      canvasId: 'ca-blocks-donut',
      totalId: 'ca-blocks-total',
      subtitleId: 'ca-blocks-subtitle',
      legendId: 'ca-blocks-legend',
    },
  ];

  async function init() {
    await loadData();
    // Auto-refresh every 2 minutes (polling cycle is 15 min, but if the user
    // leaves the page open during a cycle we still want them to see the update).
    refreshInterval = setInterval(loadData, 2 * 60 * 1000);

    // Modal close button + overlay click-to-close
    const modalCloseBtn = document.getElementById('da-modal-close-btn');
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', () => closeEventModal());
    const modalOverlay = document.getElementById('da-event-modal-overlay');
    if (modalOverlay) {
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeEventModal();
      });
    }
    // Slideout close button + overlay click-to-close
    const slideoutCloseBtn = document.getElementById('da-slideout-close-btn');
    if (slideoutCloseBtn) slideoutCloseBtn.addEventListener('click', () => closeSlideout());
    const slideoutOverlay = document.getElementById('da-slideout-overlay');
    if (slideoutOverlay) {
      slideoutOverlay.addEventListener('click', (e) => {
        if (e.target === slideoutOverlay) closeSlideout();
      });
    }
    // ESC key closes modals
    document.addEventListener('keydown', _handleEsc);
  }

  function _handleEsc(e) {
    if (e.key === 'Escape') {
      const slideout = document.getElementById('da-slideout-overlay');
      if (slideout && slideout.style.display !== 'none') {
        closeSlideout();
        return;
      }
      const modal = document.getElementById('da-event-modal-overlay');
      if (modal && modal.style.display !== 'none') {
        closeEventModal();
      }
    }
  }

  function destroy() {
    if (loginFailuresChart) { loginFailuresChart.destroy(); loginFailuresChart = null; }
    if (caBlocksChart)      { caBlocksChart.destroy();      caBlocksChart = null; }
    if (refreshInterval)    { clearInterval(refreshInterval); refreshInterval = null; }
    document.removeEventListener('keydown', _handleEsc);
  }

  async function loadData() {
    try {
      const data = await Panoptica.api('/api/daily-activity');

      const ts = document.getElementById('daily-activity-generated-at');
      if (ts && data.generated_at) {
        const dt = new Date(data.generated_at);
        ts.textContent = 'As of ' + dt.toLocaleString('en-CA', {
          hour: '2-digit', minute: '2-digit', hour12: false,
        });
      }

      for (const widget of WIDGETS) {
        const w = data.widgets?.[widget.key];
        if (!w) {
          renderEmpty(widget, 'No data — policy not configured');
          continue;
        }
        renderWidget(widget, w);
      }
    } catch (err) {
      console.error('[DailyActivity] Load failed:', err);
      Panoptica.showToast(window.t('daily_activity.toast_load_failed'), 'error');
      for (const widget of WIDGETS) {
        renderEmpty(widget, 'Load failed');
      }
    }
  }

  function renderEmpty(widget, message) {
    const totalEl = document.getElementById(widget.totalId);
    const subtitleEl = document.getElementById(widget.subtitleId);
    const legendEl = document.getElementById(widget.legendId);
    if (totalEl) totalEl.textContent = '—';
    if (subtitleEl) subtitleEl.textContent = message || '';
    if (legendEl) legendEl.innerHTML = `<div class="donut-legend-empty">${escHtml(message || 'No data')}</div>`;

    const canvas = document.getElementById(widget.canvasId);
    if (!canvas) return;
    const existing = widget.key === 'login_failures' ? loginFailuresChart : caBlocksChart;
    if (existing) {
      existing.destroy();
      if (widget.key === 'login_failures') loginFailuresChart = null;
      else caBlocksChart = null;
    }
  }

  function renderWidget(widget, data) {
    const totalEl = document.getElementById(widget.totalId);
    const subtitleEl = document.getElementById(widget.subtitleId);
    const legendEl = document.getElementById(widget.legendId);
    const canvas = document.getElementById(widget.canvasId);
    if (!canvas) return;

    // Only include tenants with activity > 0 — zero-count tenants would be
    // invisible slivers anyway and would crowd the legend.
    const active = (data.tenants || []).filter(t => t.today > 0);
    active.sort((a, b) => b.today - a.today);

    // Center total
    if (totalEl) totalEl.textContent = data.total_today != null ? data.total_today.toLocaleString('en-CA') : '—';
    if (subtitleEl) {
      const tenantWord = active.length === 1 ? 'tenant' : 'tenants';
      subtitleEl.textContent = `${active.length} active ${tenantWord}`;
    }

    // Handle empty state — all tenants had zero activity today
    if (active.length === 0) {
      if (legendEl) {
        legendEl.innerHTML = '<div class="donut-legend-empty">No activity today across any tenant — that\'s a good sign.</div>';
      }
      // Render a single neutral segment so the donut doesn't look broken
      drawChart(widget, canvas, [{
        display_name: 'No activity',
        today: 1,
        avg: 0,
        deviation_pct: 0,
        color: 'rgba(80, 100, 140, 0.25)',
      }], { placeholder: true });
      return;
    }

    drawChart(widget, canvas, active, { placeholder: false });

    // Legend
    if (legendEl) {
      legendEl.innerHTML = active.map(t => {
        const pctText = formatDeviation(t);
        const baselineText = t.avg != null
          ? `avg ${t.avg}/day (${t.baseline_days}d)`
          : 'no baseline yet';
        return `
          <div class="donut-legend-row" data-tenant-id="${t.tenant_db_id}" title="Click to open tenant dashboard">
            <span class="donut-legend-chip" style="background:${t.color};"></span>
            <span class="donut-legend-name">${escHtml(t.display_name)}</span>
            <span class="donut-legend-count">${t.today}</span>
            <span class="donut-legend-delta">${pctText}</span>
            <span class="donut-legend-baseline">${baselineText}</span>
          </div>
        `;
      }).join('');

      // Wire click-through on legend rows — opens event detail modal
      legendEl.querySelectorAll('.donut-legend-row').forEach(row => {
        row.addEventListener('click', () => {
          const tenantId = row.dataset.tenantId;
          const tenantName = row.querySelector('.donut-legend-name')?.textContent || '';
          const eventType = widget.key === 'ca_blocks' ? 'ca_block' : 'login_failure';
          if (tenantId) openEventModal(tenantId, tenantName, eventType, widget.key);
        });
      });
    }
  }

  function drawChart(widget, canvas, tenants, opts) {
    const ctx = canvas.getContext('2d');
    const existing = widget.key === 'login_failures' ? loginFailuresChart : caBlocksChart;
    if (existing) existing.destroy();

    // Apr 28, 2026 — read theme tokens so chart colors track light/dark.
    // Was hardcoded `#0a1530` (dark navy) for slice borders; on the light
    // theme that printed as harsh black scratches between slices.
    // Chart.js's default tooltip is also hardcoded dark — we override it
    // explicitly so the hover tooltip uses the active theme's surface +
    // text colors instead of looking like a foreign overlay.
    const cssVar = (name, fallback) => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    };
    const sliceBorderColor = cssVar('--p-bg', '#0a1530');
    const tipBg            = cssVar('--p-surface-deep', 'rgba(0,0,0,0.85)');
    const tipText          = cssVar('--p-text', '#ffffff');
    const tipBorder        = cssVar('--p-border', 'rgba(0,0,0,0.4)');

    const chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: tenants.map(t => t.display_name),
        datasets: [{
          data: tenants.map(t => t.today),
          backgroundColor: tenants.map(t => t.color),
          borderColor: sliceBorderColor,
          borderWidth: 2,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: false,
        cutout: '62%',
        // hoverOffset: 8 pushes the hovered slice 8px outward, beyond the
        // base donut radius. Without matching layout padding, slices that
        // touch the canvas edge get CLIPPED on hover — visible as a flat
        // cutoff on the right/bottom (depending on which slice is hovered).
        // Reserve 10px on every side so the offset has room to render.
        // Predates the light-theme work — was always there on the dark
        // theme too, just less obvious against the matching dark bg.
        layout: { padding: 10 },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: !opts.placeholder,
            backgroundColor: tipBg,
            titleColor: tipText,
            bodyColor: tipText,
            borderColor: tipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 6,
            displayColors: false,
            // No caret arrow — on light theme the small pointer triangle
            // reads as a sharp wedge "eating" the donut. Cleaner without.
            caretSize: 0,
            caretPadding: 6,
            callbacks: {
              title: (items) => items[0].label,
              label: (ctx) => {
                const t = tenants[ctx.dataIndex];
                const lines = [
                  `Today: ${t.today}`,
                  t.avg != null
                    ? `7-day avg: ${t.avg} (${t.baseline_days} day${t.baseline_days !== 1 ? 's' : ''})`
                    : 'No baseline yet',
                ];
                if (t.deviation_pct != null) {
                  const sign = t.deviation_pct >= 0 ? '+' : '';
                  lines.push(`Deviation: ${sign}${t.deviation_pct}%`);
                } else if (t.avg === 0 && t.today > 0) {
                  lines.push('Deviation: new activity (avg was 0)');
                }
                return lines;
              },
            },
          },
        },
      },
    });

    if (widget.key === 'login_failures') loginFailuresChart = chart;
    else caBlocksChart = chart;
  }

  function formatDeviation(t) {
    if (t.deviation_pct == null) {
      return t.avg === 0 && t.today > 0 ? 'new' : '—';
    }
    const sign = t.deviation_pct >= 0 ? '+' : '';
    return `${sign}${t.deviation_pct}%`;
  }

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  /**
   * Render a Haiku summary that may contain stray markdown tokens as clean HTML.
   *
   * Haiku has been observed to emit `#` headings, `**bold**` labels, and pipe
   * separators inline (e.g. `# Summary **Date:** Apr 19 | **Total Events:** 1`)
   * despite the prompt forbidding markdown. We escape the whole string first
   * for XSS safety, then apply a narrow whitelist of markdown → HTML rules.
   *
   * Kept deliberately minimal — we're not parsing arbitrary markdown, just
   * taming Haiku's drift patterns. If Haiku starts emitting new tokens we'll
   * add to this helper rather than pulling in a full parser.
   */
  function renderSummaryMarkdown(raw) {
    if (!raw) return '';
    let s = escHtml(raw);
    // 1. Heading at start of string or line: "# Title ..." up to the next **bold**
    //    label or end of line, whichever comes first. Haiku inlines headings with
    //    the rest of the text, so we can't just match to EOL.
    s = s.replace(
      /(^|\n)\s*#{1,6}\s+([^\n]+?)(?=\s*(?:\*\*|\n|$))/g,
      (_m, lead, txt) => `${lead}<div class="da-ai-heading">${txt.trim()}</div>`
    );
    // 2. Bold: **text** → <strong>text</strong>
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 3. Inline pipe dividers → line breaks so label/value pairs stack
    s = s.replace(/\s+\|\s+/g, '<br>');
    // 4. Paragraph breaks on double newlines; single newline → space inside a
    //    paragraph. Wrap each non-empty chunk in <p>.
    const parts = s.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    return parts.map(p => `<p>${p.replace(/\n+/g, ' ')}</p>`).join('');
  }

  // ═══════════════════════════════════════════
  // EVENT DETAIL MODAL
  // ═══════════════════════════════════════════

  let _currentEvents = []; // cache for slide-out access

  async function openEventModal(tenantId, tenantName, eventType, widgetKey) {
    const overlay = document.getElementById('da-event-modal-overlay');
    const title = document.getElementById('da-modal-title');
    const tbody = document.getElementById('da-event-tbody');
    const emptyMsg = document.getElementById('da-event-empty');
    const aiSummary = document.getElementById('da-ai-summary');
    const aiText = document.getElementById('da-ai-text');

    if (!overlay) return;

    const label = widgetKey === 'ca_blocks' ? 'CA Blocks' : 'Login Failures';
    title.textContent = `${escHtml(tenantName)} — ${label}`;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;">Loading...</td></tr>';
    emptyMsg.style.display = 'none';
    aiSummary.style.display = 'none';
    overlay.style.display = 'flex';

    try {
      const data = await Panoptica.api(`/api/daily-activity/events?tenant_id=${tenantId}&event_type=${eventType}`);
      _currentEvents = data.events || [];

      // Render AI summary if available. Haiku occasionally emits markdown
      // tokens (# headings, **bold**, pipe separators) despite the prompt
      // telling it not to — renderSummaryMarkdown() converts those into HTML
      // so operators don't see raw markdown in the modal.
      if (data.summary && data.summary.summary) {
        aiText.innerHTML = renderSummaryMarkdown(data.summary.summary);
        aiSummary.style.display = 'block';
      }

      if (_currentEvents.length === 0) {
        tbody.innerHTML = '';
        emptyMsg.style.display = 'block';
        return;
      }

      tbody.innerHTML = _currentEvents.map((ev, idx) => {
        const time = ev.event_time
          ? new Date(ev.event_time).toLocaleString('en-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
          : '—';
        const user = escHtml(ev.user_display_name || ev.user_principal_name || '—');
        const app = escHtml(ev.app_display_name || '—');
        const ip = escHtml(ev.ip_address || '—');
        const loc = [ev.city, ev.country].filter(Boolean).join(', ') || '—';
        const err = ev.error_code ? `${ev.error_code}` : '—';
        const risk = ev.risk_level && ev.risk_level !== 'none' ? escHtml(ev.risk_level) : '—';
        const riskClass = risk !== '—' ? 'da-risk-' + (ev.risk_level || '').toLowerCase() : '';
        return `
          <tr class="da-event-row" data-idx="${idx}" title="Click for details">
            <td>${time}</td>
            <td>${user}</td>
            <td>${app}</td>
            <td class="monospace">${ip}</td>
            <td>${escHtml(loc)}</td>
            <td class="monospace">${err}</td>
            <td class="${riskClass}">${risk}</td>
          </tr>
        `;
      }).join('');

      // Wire row clicks for slide-out
      tbody.querySelectorAll('.da-event-row').forEach(row => {
        row.addEventListener('click', () => {
          const idx = parseInt(row.dataset.idx, 10);
          if (!isNaN(idx) && _currentEvents[idx]) openSlideout(_currentEvents[idx]);
        });
      });
    } catch (err) {
      console.error('[DailyActivity] Event detail load failed:', err);
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--p-highlight);">Failed to load events</td></tr>';
    }
  }

  function closeEventModal() {
    const overlay = document.getElementById('da-event-modal-overlay');
    if (overlay) overlay.style.display = 'none';
    closeSlideout();
    _currentEvents = [];
  }

  // ═══════════════════════════════════════════
  // SLIDE-OUT DETAIL PANEL
  // ═══════════════════════════════════════════

  function openSlideout(ev) {
    const overlay = document.getElementById('da-slideout-overlay');
    const title = document.getElementById('da-slideout-title');
    const body = document.getElementById('da-slideout-body');
    if (!overlay) return;

    title.textContent = ev.user_display_name || ev.user_principal_name || 'Event Details';

    const sections = [];

    // User info
    sections.push(detailSection('User', [
      ['Display Name', ev.user_display_name],
      ['UPN', ev.user_principal_name],
    ]));

    // Sign-in info
    sections.push(detailSection('Sign-In', [
      ['Time', ev.event_time ? new Date(ev.event_time).toLocaleString('en-CA') : null],
      ['Application', ev.app_display_name],
      ['IP Address', ev.ip_address],
      ['City', ev.city],
      ['Country', ev.country],
    ]));

    // Status / Error
    sections.push(detailSection('Status', [
      ['Error Code', ev.error_code],
      ['Failure Reason', ev.failure_reason],
      ['CA Status', ev.ca_status],
      ['Risk Level', ev.risk_level && ev.risk_level !== 'none' ? ev.risk_level : null],
    ]));

    // Device
    sections.push(detailSection('Device', [
      ['Browser', ev.device_detail_browser],
      ['Operating System', ev.device_detail_os],
    ]));

    body.innerHTML = sections.join('');
    overlay.style.display = 'block';

    // Animate in
    requestAnimationFrame(() => {
      const panel = document.getElementById('da-slideout-panel');
      if (panel) panel.classList.add('open');
    });
  }

  function closeSlideout() {
    const panel = document.getElementById('da-slideout-panel');
    const overlay = document.getElementById('da-slideout-overlay');
    if (panel) panel.classList.remove('open');
    setTimeout(() => {
      if (overlay) overlay.style.display = 'none';
    }, 250);
  }

  function detailSection(title, fields) {
    const rows = fields
      .filter(([, val]) => val != null && val !== '' && val !== 'none')
      .map(([label, val]) => `
        <div class="da-detail-row">
          <span class="da-detail-label">${escHtml(label)}</span>
          <span class="da-detail-value">${escHtml(String(val))}</span>
        </div>
      `).join('');
    if (!rows) return '';
    return `<div class="da-detail-section"><div class="da-detail-section-title">${escHtml(title)}</div>${rows}</div>`;
  }

  // Expose for HTML onclick handlers
  window.PanopticaPage = { init, destroy, closeEventModal, closeSlideout };
})();
