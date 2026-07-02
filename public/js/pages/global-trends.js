/* ════════════════════════════════════════════════════════════════════════
 * Panoptica365 — Global (fleet) Trends page (B4)
 *
 * Top-level SPA page. One GET /api/global-trends?range= round-trip (DB-only,
 * managed tenants only) feeds 10 fleet charts + a coverage stat strip, drawn by
 * the shared Panoptica.TrendCharts factories. Read-only, all RBAC tiers.
 *
 * SPA lifecycle: registers window.PanopticaPage = { init, destroy }. init()
 * wires controls (addEventListener — the loader nulls PanopticaPage, so inline
 * onclick would fail) and fetches; destroy() tears every Chart instance down so
 * re-navigation never leaks/duplicates canvases.
 * ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  let charts = [];
  let currentRange = '30d';
  let currentGroup = null; // tenant-group filter (Phase 1 rider): null = whole fleet
  let _themeObs = null;
  const cache = new Map(); // `${range}|${group}` → response

  function cacheKey() { return `${currentRange}|${currentGroup || ''}`; }

  function gtT(key, params) { return window.t('global_trends.' + key, params); }
  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
  function el(id) { return document.getElementById(id); }
  function curLang() {
    try { return (window.PanopticaI18n && PanopticaI18n.currentLang && PanopticaI18n.currentLang()) || 'en'; }
    catch (_) { return 'en'; }
  }
  function fmtDay(d) { const p = String(d).split('-'); return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : String(d); }
  function fmtMonth(m) {
    try {
      const [y, mo] = String(m).split('-').map(Number);
      return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(curLang(), { month: 'short', year: '2-digit', timeZone: 'UTC' });
    } catch (_) { return String(m); }
  }

  function destroyCharts() {
    if (charts && charts.length) charts.forEach(c => { try { c.destroy(); } catch (_) {} });
    charts = [];
  }

  async function init() {
    document.querySelectorAll('#gt-view .gt-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = btn.dataset.range;
        if (r === currentRange) return;
        currentRange = r;
        document.querySelectorAll('#gt-view .gt-pill').forEach(b => b.classList.toggle('active', b.dataset.range === r));
        load();
      });
    });
    const refresh = el('gt-refresh-btn');
    if (refresh) refresh.addEventListener('click', () => load(true));
    document.querySelectorAll('#gt-view .gt-pill').forEach(b => b.classList.toggle('active', b.dataset.range === currentRange));

    // Mount the shared group-filter dropdown (fail-soft — absent until a
    // group exists; a load failure leaves the page exactly as before).
    currentGroup = null;
    const filterHost = el('gt-group-filter');
    if (filterHost && window.PanopticaGroupFilter) {
      window.PanopticaGroupFilter.mount(filterHost, {
        value: null,
        onChange: (groupId) => { currentGroup = groupId; load(); },
      });
    }

    // Re-resolve chart colours on a light/dark theme switch.
    const themeLink = document.getElementById('theme-css');
    if (themeLink && window.MutationObserver) {
      _themeObs = new MutationObserver(() => { if (cache.has(cacheKey())) render(cache.get(cacheKey())); });
      _themeObs.observe(themeLink, { attributes: true, attributeFilter: ['href'] });
    }

    await load();
  }

  function destroy() {
    destroyCharts();
    if (_themeObs) { try { _themeObs.disconnect(); } catch (_) {} _themeObs = null; }
  }

  let loadSeq = 0; // guards out-of-order responses on quick range/group flips

  async function load(force) {
    const seq = ++loadSeq;
    const status = el('gt-status');
    if (!force && cache.has(cacheKey())) { render(cache.get(cacheKey())); return; }
    if (status) status.textContent = gtT('loading');
    const key = cacheKey();
    try {
      const url = '/api/global-trends?range=' + encodeURIComponent(currentRange)
        + (currentGroup ? '&group=' + encodeURIComponent(currentGroup) : '');
      const data = await window.Panoptica.api(url);
      cache.set(key, data); // cache under the key this fetch was issued for
      if (seq !== loadSeq) return; // a newer load superseded this one
      render(data);
      if (status) status.textContent = '';
    } catch (e) {
      if (seq !== loadSeq) return;
      destroyCharts();
      if (status) status.textContent = gtT('load_failed');
    }
  }

  // ── KPI / strip helpers ──
  function setCoverage(cov, stats) {
    const node = el('gt-coverage');
    if (!node) return;
    if (!cov || !cov.of) { node.style.display = 'none'; node.innerHTML = ''; return; }
    node.style.display = '';
    const s = stats || {};
    node.innerHTML =
      `<span class="cov-badge">${cov.at_100} / ${cov.of}</span>` +
      `<span class="cov-text"><b>${esc(gtT('coverage_label'))}</b> — ${esc(gtT('coverage_detail', { at: cov.at_100, of: cov.of, avg: cov.fleet_avg_pct != null ? cov.fleet_avg_pct : '—' }))}</span>` +
      `<span class="cov-mini">` +
        `<span><span class="n">${Number(s.resolved_90d) || 0}</span><span class="l">${esc(gtT('stat_resolved_90d'))}</span></span>` +
        `<span><span class="n">${Number(s.open_now) || 0}</span><span class="l">${esc(gtT('stat_open_now'))}</span></span>` +
      `</span>`;
  }

  function setSecureKpi(series, hasBenchmark) {
    const node = el('gt-secure-kpi');
    if (!node) return;
    if (!series.length) { node.innerHTML = `<span class="big">—</span>`; return; }
    const last = series[series.length - 1];
    const delta = Math.round(last.avg - series[0].avg);
    const up = delta >= 0;
    let html =
      `<span class="big">${last.avg}%</span>` +
      `<span class="delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(delta)} ${esc(gtT('unit_pts'))}</span>` +
      `<span class="since">${esc(gtT('kpi_fleet_of', { n: last.tenants }))}</span>`;
    if (hasBenchmark && last.benchmark != null) {
      const diff = last.avg - last.benchmark;
      html += `<span class="bench">${esc(gtT('benchmark_pill', { pts: (diff >= 0 ? '+' : '') + diff, bench: last.benchmark }))}</span>`;
    }
    node.innerHTML = html;
  }

  function setRecKpi(series) {
    const node = el('gt-recommendations-kpi');
    if (!node) return;
    if (!series.length) { node.innerHTML = `<span class="big">—</span>`; return; }
    const last = series[series.length - 1];
    const delta = last.outstanding - series[0].outstanding;
    const down = delta <= 0; // fewer outstanding is better
    node.innerHTML =
      `<span class="big">${last.outstanding}</span>` +
      `<span class="delta ${down ? 'up' : 'down'}">${down ? '▼' : '▲'} ${Math.abs(delta)}</span>` +
      `<span class="since">${esc(gtT('rec_addressed_pct', { pct: last.addressed_pct != null ? last.addressed_pct : '—' }))}</span>`;
  }

  function setTtrKpi(series) {
    const node = el('gt-ttr-kpi');
    if (!node) return;
    if (!series.length) { node.innerHTML = `<span class="big">—</span>`; return; }
    const last = series[series.length - 1];
    node.innerHTML =
      `<span class="big">${last.median_hours}${esc(gtT('unit_hours'))}</span>` +
      `<span class="since">${esc(gtT('ttr_kpi_p90', { p90: last.p90_hours }))}</span>`;
  }

  function setResolvedStats(stats) {
    const node = el('gt-resolved-stats');
    if (!node) return;
    const s = stats || {};
    const item = (n, l) => `<div class="stat"><div class="n">${Number(n) || 0}</div><div class="l">${esc(l)}</div></div>`;
    node.innerHTML =
      item(s.resolved_90d, gtT('stat_resolved_90d')) +
      item(s.severe_high_90d, gtT('stat_severe_high')) +
      item(s.open_now, gtT('stat_open_now'));
  }

  function legendChip(swatch, label) { return `<span><i ${swatch}></i>${esc(label)}</span>`; }

  // ── Render ──
  function render(data) {
    destroyCharts();
    const TC = window.Panoptica && Panoptica.TrendCharts;
    if (!TC || !data) return;

    const body = el('gt-body');
    const empty = el('gt-empty');
    if (!data.managed_tenant_count) {
      if (body) body.style.display = 'none';
      if (empty) empty.style.display = '';
      return;
    }
    if (body) body.style.display = '';
    if (empty) empty.style.display = 'none';

    const C = TC.readColors();
    const rgba = TC.rgba;
    const sevLegend = {
      severe: gtT('legend_severe'), high_med: gtT('legend_high_med'),
      low: gtT('legend_low'), info: gtT('legend_info'),
    };

    setCoverage(data.coverage, data.stats);

    // 1. Fleet Secure Score hero — avg line + min/max band + benchmark + like-for-like.
    const sf = data.secure_fleet || [];
    const hasBenchmark = sf.some(x => x.benchmark != null);
    const onboardedTotal = (data.tenant_count || []).reduce((s, x) => s + (Number(x.onboarded) || 0), 0);
    const hadOnboarding = onboardedTotal > 0;
    const labels = sf.map(x => fmtDay(x.d));
    const band = rgba(C.accent, 0.30);
    const lines = [
      { label: gtT('legend_highest'), data: sf.map(x => x.max), color: band, borderWidth: 1, unit: '%' },
      { label: gtT('legend_lowest'), data: sf.map(x => x.min), color: band, borderWidth: 1, fillTarget: '-1', fillColor: rgba(C.accent, 0.12), unit: '%' },
      { label: gtT('legend_avg'), data: sf.map(x => x.avg), color: C.accent, borderWidth: 3, unit: '%' },
    ];
    if (hasBenchmark) lines.push({ label: gtT('legend_benchmark'), data: sf.map(x => (x.benchmark != null ? x.benchmark : null)), color: C.secondary, dashed: true, unit: '%' });
    if (hadOnboarding && (data.secure_like_for_like || []).length) {
      const llByDay = new Map((data.secure_like_for_like || []).map(x => [x.d, x.avg]));
      lines.push({ label: gtT('legend_like_for_like'), data: sf.map(x => (llByDay.has(x.d) ? llByDay.get(x.d) : null)), color: C.success, borderWidth: 2, unit: '%' });
    }
    charts.push(TC.multiLine(el('gt-secure'), { labels, lines }, {
      pct: true, beginAtZero: false,
      tooltipFooters: sf.map(x => gtT('tooltip_tenants', { n: x.tenants })),
    }));
    setSecureKpi(sf, hasBenchmark);
    // static legend
    const legNode = el('gt-secure-legend');
    if (legNode) {
      let h = legendChip(`style="background:var(--p-accent)"`, gtT('legend_avg'))
        + legendChip(`class="band"`, gtT('legend_band'));
      if (hasBenchmark) h += legendChip(`class="dash"`, gtT('legend_benchmark'));
      if (hadOnboarding) h += legendChip(`style="background:var(--p-success)"`, gtT('legend_like_for_like'));
      legNode.innerHTML = h;
    }
    const note = el('gt-secure-note');
    if (note) {
      if (hadOnboarding) { note.textContent = gtT('onboarding_note', { n: onboardedTotal }); note.style.display = ''; }
      else { note.style.display = 'none'; note.textContent = ''; }
    }

    // 2. Book growth — managed tenant count + onboarding markers.
    const tc = data.tenant_count || [];
    charts.push(TC.multiLine(el('gt-tenant-count'), {
      labels: tc.map(x => fmtDay(x.d)),
      lines: [
        { label: gtT('book_count'), data: tc.map(x => x.count), color: C.accent, fill: true, fillColor: rgba(C.accent, 0.12), borderWidth: 2 },
        { label: gtT('book_onboarded'), data: tc.map(x => (x.onboarded > 0 ? x.count : null)), color: C.success, showLine: false, pointRadius: 4, borderWidth: 0 },
      ],
    }, { beginAtZero: true }));

    // 4. Recommendations outstanding (line; lower is better).
    const rec = data.recommendations || [];
    charts.push(TC.lineTrend(el('gt-recommendations'),
      { labels: rec.map(x => fmtDay(x.d)), data: rec.map(x => x.outstanding) },
      { color: C.warn, label: gtT('recommendations_title') }));
    setRecKpi(rec);
    const recNote = el('gt-recommendations-note');
    if (recNote) {
      if (!rec.length && sf.length) { recNote.textContent = gtT('rec_unavailable'); recNote.style.display = ''; }
      else { recNote.style.display = 'none'; recNote.textContent = ''; }
    }

    // 3. Secure Score by category (stacked area, fleet-avg %-of-score).
    const cats = data.secure_by_category || [];
    const catKeys = [];
    for (const row of cats) for (const k of Object.keys(row)) if (k !== 'd' && catKeys.indexOf(k) < 0) catKeys.push(k);
    const CAT_ORDER = ['identity', 'data', 'device', 'apps', 'infrastructure'];
    catKeys.sort((a, b) => {
      const ia = CAT_ORDER.indexOf(a.toLowerCase()), ib = CAT_ORDER.indexOf(b.toLowerCase());
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const CAT_COLORS = { identity: C.accent, data: C.success, device: C.warn, apps: C.secondary, infrastructure: C.info };
    const palette = [C.accent, C.success, C.warn, C.secondary, C.info];
    charts.push(TC.stackedArea(el('gt-category'), {
      labels: cats.map(x => fmtDay(x.d)),
      datasets: catKeys.map((k, i) => ({
        label: catLabel(k),
        data: cats.map(r => (r[k] != null ? r[k] : 0)),
        color: CAT_COLORS[k.toLowerCase()] || palette[i % palette.length],
      })),
    }, { pct: true, yMax: 100 }));

    // 5. Issues resolved by month (stacked severity).
    const rbm = data.resolved_by_month || [];
    charts.push(TC.stackedSeverity(el('gt-resolved'), {
      labels: rbm.map(r => fmtMonth(r.m)),
      severe: rbm.map(r => r.severe), high_med: rbm.map(r => r.high_med), low: rbm.map(r => r.low), info: rbm.map(r => r.info),
    }, { legendLabels: sevLegend }));
    setResolvedStats(data.stats);

    // 6. Open issues over time.
    const oot = data.open_over_time || [];
    charts.push(TC.lineTrend(el('gt-open'),
      { labels: oot.map(x => fmtDay(x.d)), data: oot.map(x => x.open) },
      { color: C.success, label: gtT('open_title') }));

    // 7. Time to resolve — median + p90.
    const ttr = data.ttr_weekly || [];
    charts.push(TC.multiLine(el('gt-ttr'), {
      labels: ttr.map(x => x.w),
      lines: [
        { label: gtT('ttr_median'), data: ttr.map(x => x.median_hours), color: C.accent, fill: true, fillColor: rgba(C.accent, 0.12), unit: 'h', borderWidth: 2 },
        { label: gtT('ttr_p90'), data: ttr.map(x => x.p90_hours), color: C.warn, dashed: true, unit: 'h' },
      ],
    }, { beginAtZero: true }));
    setTtrKpi(ttr);
    const ttrLeg = el('gt-ttr-legend');
    if (ttrLeg) ttrLeg.innerHTML = legendChip(`style="background:var(--p-accent)"`, gtT('ttr_median')) + legendChip(`class="dash" style="border-top-color:var(--p-warn)"`, gtT('ttr_p90'));

    // 8. Alert volume per week (stacked severity).
    const vol = data.volume_weekly || [];
    charts.push(TC.stackedSeverity(el('gt-volume'), {
      labels: vol.map(v => v.w),
      severe: vol.map(v => v.severe), high_med: vol.map(v => v.high_med), low: vol.map(v => v.low), info: vol.map(v => v.info),
    }, { legendLabels: sevLegend }));

    // 9. Alert mix by category over time (stacked area, 6 ENUM categories).
    const mix = data.alert_categories || [];
    const MIX_CATS = ['risky_signins', 'threat_mgmt', 'external_sharing', 'config_changes', 'permissions', 'info_governance'];
    const MIX_COLORS = [C.accent, C.danger, C.success, C.warn, C.secondary, C.info];
    charts.push(TC.stackedArea(el('gt-alert-mix'), {
      labels: mix.map(x => x.w),
      datasets: MIX_CATS.map((k, i) => ({ label: gtT('cat_' + k), data: mix.map(r => (r[k] != null ? r[k] : 0)), color: MIX_COLORS[i] })),
    }, {}));

    // 10. Top firing policies (ranked, fleet, 90 days).
    const pol = data.top_policies || [];
    charts.push(TC.rankedBar(el('gt-policies'),
      { labels: pol.map(p => p.name), data: pol.map(p => p.count), severities: pol.map(p => p.severity) },
      { unitLabel: gtT('policies_unit') }));
  }

  function catLabel(cat) {
    const slug = String(cat).toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const key = 'global_trends.cat_sec_' + slug;
    const api = window.PanopticaI18n;
    if (api && api.tOrFallback) return api.tOrFallback(key, String(cat));
    const v = window.t(key);
    return v === key ? String(cat) : v;
  }

  window.PanopticaPage = { init, destroy };
})();
