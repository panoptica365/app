/* ════════════════════════════════════════════════════════════════════════
 * Panoptica365 — Trend chart render factories (Feature B3, 2026-06-17)
 *
 * Pure (canvas, series, opts) => Chart.js instance factories for the per-tenant
 * Trends tab. Deliberately framework-free and DOM-free beyond the passed-in
 * <canvas>: the same functions are reused unchanged by the monthly client
 * report (B2) and prospect assessment (B1) PDF renderers, which hand in an
 * offscreen canvas and the same server series shapes.
 *
 * Chart.js is loaded globally (window.Chart, vendored at /js/shared/chart.umd.min.js).
 *
 * Conventions baked in here (see Build Instructions §6 — these are load-bearing):
 *   • Theme colours are resolved from CSS variables AT CALL TIME and passed to
 *     Chart.js as concrete strings — Chart draws on <canvas> and cannot resolve
 *     `var(--p-accent)`. Re-call the factory after a theme switch to re-resolve.
 *   • Tooltip / interaction defaults are MERGED (Object.assign), never replaced —
 *     replacing the tooltip object drops Chart.js's built-in `position:'average'`
 *     positioner and the tooltip then silently never renders.
 *   • Follow-the-mouse tooltips: interaction mode 'index' / intersect:false so
 *     hovering anywhere along x resolves to the nearest point and tracks the
 *     cursor. A vertical crosshair plugin draws under the tooltip on line charts.
 *   • maintainAspectRatio:false — every canvas lives in a fixed-height wrapper.
 *
 * Exposed as window.Panoptica.TrendCharts.
 * ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ─── Colour resolution ──────────────────────────────────────────────────
  // Read a CSS custom property off :root, with a hard fallback so an offscreen
  // render context (report PDF) that never attached our stylesheet still gets a
  // sane colour instead of an empty string.
  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (_) {
      return fallback;
    }
  }

  // #RRGGBB (or #RGB) → "rgba(r,g,b,a)". Used for translucent area fills and the
  // adaptive grid colour so the same token works in dark + light themes.
  function rgba(hex, alpha) {
    let h = String(hex || '').trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6) return `rgba(120,150,190,${alpha})`; // safe fallback
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // Resolve the full palette the charts need. Called fresh on every factory
  // invocation so a light/dark theme switch (which swaps the stylesheet) is
  // picked up the next time charts are (re-)rendered.
  function readColors() {
    const accent    = cssVar('--p-accent',     '#5CCBF4');
    const secondary = cssVar('--p-secondary',  '#B78BFF');
    const success   = cssVar('--p-success',    '#2EE8A0');
    const danger    = cssVar('--p-danger',     '#FF5A6E');
    const warn      = cssVar('--p-warn',       '#FFC04D');
    const info      = cssVar('--severity-info','#78909C');
    const textMuted = cssVar('--p-text-muted', '#6B85A6');
    const textSec   = cssVar('--p-text-secondary', '#B0C4DF');
    const text      = cssVar('--p-text',       '#EEF4FC');
    const sunken    = cssVar('--p-surface-sunken', '#04101E');
    const borderStr = cssVar('--p-border-strong',  '#335F92');
    return {
      accent, secondary, success, danger, warn, info,
      textMuted, textSec, text,
      accentFill:    rgba(accent,    0.16),
      secondaryFill: rgba(secondary, 0.13),
      successFill:   rgba(success,   0.13),
      grid:          rgba(textMuted, 0.16),
      tooltipBg:     sunken,
      tooltipBorder: borderStr,
      crosshair:     rgba(accent, 0.45),
      // Map an alert severity to its line/bar colour. severe→danger, high &
      // medium→warn, low→accent, info→grey (matches the Build Instructions §6
      // token table and the on-screen legends).
      forSeverity(sev) {
        switch (String(sev || '').toLowerCase()) {
          case 'severe': return danger;
          case 'high':   return warn;
          case 'medium': return warn;
          case 'low':    return accent;
          case 'info':   return info;
          default:       return info;
        }
      },
    };
  }

  // ─── Global Chart.js defaults (idempotent) ──────────────────────────────
  // MERGE — never replace — so Chart's internal positioner/animation defaults
  // survive. Re-applied colours each call so a theme switch updates the shared
  // tooltip chrome too.
  function ensureGlobals() {
    if (!window.Chart) return;
    const C = window.Chart;
    const c = readColors();
    C.defaults.font.family = "'Geist','Inter',system-ui,-apple-system,sans-serif";
    C.defaults.font.size = 11;
    C.defaults.color = c.textMuted;
    Object.assign(C.defaults.interaction, { mode: 'index', intersect: false, axis: 'x' });
    Object.assign(C.defaults.plugins.tooltip, {
      enabled: true,
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      borderWidth: 1,
      titleColor: c.textSec,
      bodyColor: c.text,
      padding: 10,
      cornerRadius: 6,
      caretSize: 5,
      titleFont: { family: "'Geist Mono','JetBrains Mono',monospace", size: 11 },
      bodyFont: { size: 12, weight: '600' },
    });
  }

  // Vertical crosshair at the active tooltip x — drawn UNDER the tooltip on
  // line charts so the follow-the-mouse readout has a clear cursor line.
  const crosshairPlugin = {
    id: 'panopticaCrosshair',
    afterDraw(chart, _args, pluginOpts) {
      const t = chart.tooltip;
      if (!t || !t.getActiveElements || !t.getActiveElements().length) return;
      const x = t.getActiveElements()[0].element.x;
      const area = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, area.top);
      ctx.lineTo(x, area.bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = (pluginOpts && pluginOpts.color) || 'rgba(125,217,249,.45)';
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.restore();
    },
  };

  // Shared cartesian scale builder. `pct` clamps + suffixes the y axis as a
  // percentage; `unitSuffix` appends e.g. 'h' for the TTR chart.
  function cartesianScales(c, opts) {
    opts = opts || {};
    const y = {
      grid: { color: c.grid },
      ticks: { padding: 6 },
      beginAtZero: opts.beginAtZero !== false,
    };
    if (opts.yMin != null) y.min = opts.yMin;
    if (opts.yMax != null) y.max = opts.yMax;
    if (opts.pct) y.ticks.callback = (v) => v + '%';
    else if (opts.unitSuffix) y.ticks.callback = (v) => v + opts.unitSuffix;
    return {
      x: { grid: { color: c.grid }, ticks: { maxRotation: 0, autoSkipPadding: 14 } },
      y,
    };
  }

  // ─── Factory: line / area trend ─────────────────────────────────────────
  // series: { labels: string[], data: number[] }
  // opts:   { color, fill, unit, pct, yMin, yMax, tension, label, beginAtZero }
  function lineTrend(canvas, series, opts) {
    ensureGlobals();
    const c = readColors();
    opts = opts || {};
    const line = opts.color || c.accent;
    const fillColor = opts.fillColor || rgba(line, 0.15);
    const ds = {
      label: opts.label || '',
      _unit: opts.unit || '',
      data: (series && series.data) || [],
      borderColor: line,
      backgroundColor: fillColor,
      fill: opts.fill !== false,
      tension: opts.tension != null ? opts.tension : 0.3,
      pointRadius: 0,
      pointHoverRadius: 4,
      borderWidth: opts.borderWidth || 2.5,
    };
    return new window.Chart(canvas, {
      type: 'line',
      data: { labels: (series && series.labels) || [], datasets: [ds] },
      options: {
        maintainAspectRatio: false,
        animation: opts.animate === false ? false : undefined,
        plugins: {
          legend: { display: false },
          tooltip: {
            position: 'average',
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${ctx.parsed.y}${ctx.dataset._unit || ''}`,
            },
          },
          panopticaCrosshair: { color: c.crosshair },
        },
        scales: cartesianScales(c, {
          pct: opts.pct, unitSuffix: opts.unit, yMin: opts.yMin, yMax: opts.yMax,
          beginAtZero: opts.beginAtZero,
        }),
      },
      plugins: [crosshairPlugin],
    });
  }

  // ─── Factory: stacked severity bar ──────────────────────────────────────
  // buckets: { labels, severe[], high_med[], low[], info[] }
  // legendLabels: { severe, high_med, low, info } (already localised strings)
  function stackedSeverity(canvas, buckets, opts) {
    ensureGlobals();
    const c = readColors();
    opts = opts || {};
    const L = opts.legendLabels || { severe: 'Severe', high_med: 'High/Med', low: 'Low', info: 'Info' };
    const stack = opts.stackId || 'sev';
    const mk = (label, data, color) => ({ label, data: data || [], backgroundColor: color, stack, borderWidth: 0 });
    return new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels: (buckets && buckets.labels) || [],
        datasets: [
          mk(L.severe,   buckets && buckets.severe,   c.danger),
          mk(L.high_med, buckets && buckets.high_med, c.warn),
          mk(L.low,      buckets && buckets.low,      c.accent),
          mk(L.info,     buckets && buckets.info,     c.info),
        ],
      },
      options: {
        maintainAspectRatio: false,
        // Stacked bars need the built-in legend (or a static key) so the colour
        // → severity mapping is readable. We render Chart's legend here.
        plugins: {
          legend: opts.legend === false ? { display: false }
            : { display: true, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 12, color: c.textSec, font: { size: 11 } } },
          tooltip: { position: 'average' },
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: c.grid }, beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  }

  // ─── Factory: ranked horizontal bar ─────────────────────────────────────
  // rows: { labels[], data[], severities[] } — one bar per row, coloured by the
  // policy's dominant severity. unitLabel localises the tooltip ("alerts · 90 d").
  function rankedBar(canvas, rows, opts) {
    ensureGlobals();
    const c = readColors();
    opts = opts || {};
    const labels = (rows && rows.labels) || [];
    const data = (rows && rows.data) || [];
    const sevs = (rows && rows.severities) || [];
    const barColors = labels.map((_, i) => c.forSeverity(sevs[i]));
    const unitLabel = opts.unitLabel || 'alerts';
    return new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: unitLabel, data, backgroundColor: barColors, borderRadius: 3, barThickness: 15 }],
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false, axis: 'y' },
        plugins: {
          legend: { display: false },
          tooltip: { position: 'average', callbacks: { label: (ctx) => ` ${ctx.parsed.x} ${unitLabel}` } },
        },
        scales: {
          x: { grid: { color: c.grid }, beginAtZero: true, ticks: { precision: 0 } },
          y: { grid: { display: false }, ticks: { font: { size: 11.5 }, color: c.textSec } },
        },
      },
    });
  }

  // ─── Factory: multi-line (e.g. metric + benchmark overlay, min/max band) ──
  // series: { labels, lines: [ {
  //   label, data, color, unit?, borderWidth?, tension?,
  //   fill?      — fill to origin (boolean),
  //   fillTarget?— Chart.js fill target ('-1', a dataset index, etc.) for a band;
  //   fillColor? — translucent fill colour,
  //   dashed?    — dashed stroke (benchmark),
  //   pointRadius?, showLine? — points-only markers (onboarding dots),
  // } ] }
  // opts.tooltipFooters — optional array (one per x label) shown as a tooltip
  // footer (e.g. the managed-tenant count for that day on the fleet hero).
  // Legend OFF by default — callers render a static HTML legend so dashed/band
  // swatches read correctly.
  function multiLine(canvas, series, opts) {
    ensureGlobals();
    const c = readColors();
    opts = opts || {};
    const lines = (series && series.lines) || [];
    const datasets = lines.map((ln) => {
      const colour = ln.color || c.accent;
      const fillVal = ln.fillTarget !== undefined ? ln.fillTarget : !!ln.fill;
      const filled = fillVal !== false && fillVal !== undefined;
      return {
        label: ln.label || '',
        _unit: ln.unit || '',
        data: ln.data || [],
        borderColor: colour,
        backgroundColor: filled ? (ln.fillColor || rgba(colour, 0.15)) : 'transparent',
        fill: fillVal,
        borderDash: ln.dashed ? [5, 4] : undefined,
        tension: ln.tension != null ? ln.tension : 0.3,
        pointRadius: ln.pointRadius != null ? ln.pointRadius : 0,
        pointHoverRadius: ln.dashed ? 0 : 4,
        borderWidth: ln.borderWidth != null ? ln.borderWidth : (ln.dashed ? 1.5 : 2.5),
        showLine: ln.showLine !== false,
        spanGaps: true,
      };
    });
    const footers = opts.tooltipFooters;
    return new window.Chart(canvas, {
      type: 'line',
      data: { labels: (series && series.labels) || [], datasets },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: opts.legend === true },
          tooltip: {
            position: 'average',
            callbacks: {
              label: (ctx) => (ctx.parsed.y == null ? null : ` ${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${ctx.parsed.y}${ctx.dataset._unit || ''}`),
              footer: Array.isArray(footers) ? (items) => (items.length ? (footers[items[0].dataIndex] || '') : '') : undefined,
            },
          },
          panopticaCrosshair: { color: c.crosshair },
        },
        scales: cartesianScales(c, { pct: opts.pct, yMin: opts.yMin, yMax: opts.yMax, beginAtZero: opts.beginAtZero }),
      },
      plugins: [crosshairPlugin],
    });
  }

  // ─── Factory: stacked area over time ────────────────────────────────────
  // buckets: { labels, datasets: [ { label, data, color } ] }
  // Used by Secure Score by-category. Categories are data-driven (Identity /
  // Data / Device / Apps / Infrastructure / …), so the built-in legend labels
  // them automatically. `yMax`+`pct` frame it as "% of score"; the empty space
  // above the stack is the gap to 100%.
  function stackedArea(canvas, buckets, opts) {
    ensureGlobals();
    const c = readColors();
    opts = opts || {};
    const datasets = ((buckets && buckets.datasets) || []).map((d) => ({
      label: d.label,
      data: d.data || [],
      borderColor: d.color,
      backgroundColor: rgba(d.color, 0.4),
      fill: true,
      stack: 'area',
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 3,
      borderWidth: 1,
    }));
    return new window.Chart(canvas, {
      type: 'line',
      data: { labels: (buckets && buckets.labels) || [], datasets },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: opts.legend === false ? { display: false }
            : { display: true, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 12, color: c.textSec, font: { size: 11 } } },
          tooltip: { position: 'average', callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y}${opts.unit || (opts.pct ? '%' : '')}` } },
        },
        scales: {
          x: { grid: { color: c.grid }, ticks: { maxRotation: 0, autoSkipPadding: 14 } },
          y: {
            stacked: true, grid: { color: c.grid }, beginAtZero: true,
            max: opts.yMax,
            ticks: opts.pct ? { callback: (v) => v + '%' } : {},
          },
        },
      },
    });
  }

  window.Panoptica = window.Panoptica || {};
  window.Panoptica.TrendCharts = {
    readColors,
    rgba,
    ensureGlobals,
    lineTrend,
    multiLine,
    stackedArea,
    stackedSeverity,
    rankedBar,
  };
})();
