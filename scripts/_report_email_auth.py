#!/usr/bin/env python3
"""Shared email-authentication rendering helpers for the Panoptica365 report
generators (Security Posture + Quick Assessment).

Both reports surface the SAME cached email-auth posture, so the deterministic,
style-agnostic pieces — the grade-banded gauge and the findings→row mapping —
live here once. Each generator builds its own table/section with its own cell
styles; only the logic and the localized strings are shared, so the two reports
can never drift apart (QA report polish build doc, Item 2).

Localized mechanism / status / finding strings are read from the SAME locale
tree the dashboard tab uses: locales/<lang>.json → tenant_dashboard.email_auth.*
"""

import os
import json

# matplotlib is imported lazily inside generate_email_auth_gauge() so the
# text-only helpers (email_auth_label, mechanism_rows) carry no charting
# dependency — the Configuration Documentation report imports those two without
# pulling in matplotlib.

# Grade → colour band (mirrors the web tab's eaGauge). Independent of either
# report's palette so the gauge renders identically in both.
EA_GRADE_COLORS = {
    'A': '#33CC66', 'B': '#7FB069', 'C': '#F5BF4F', 'D': '#F0913F', 'F': '#CC4444',
}

# Dark brand colour for the centred score (both reports use #2C3E50 as primary).
_SCORE_TEXT_COLOR = '#2C3E50'

_LOCALE_CACHE = {}


def _load_locale(project_root, lang):
    """Load locales/<lang>.json once; cached. Returns {} on miss."""
    if lang in _LOCALE_CACHE:
        return _LOCALE_CACHE[lang]
    path = os.path.join(project_root, 'locales', f'{lang}.json')
    try:
        with open(path, 'r', encoding='utf-8') as f:
            _LOCALE_CACHE[lang] = json.load(f)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        _LOCALE_CACHE[lang] = {}
    return _LOCALE_CACHE[lang]


def email_auth_label(project_root, lang, subpath, params=None):
    """Read tenant_dashboard.email_auth.<subpath> from locales/<lang>.json — the
    SAME source the dashboard tab uses (mech / status / finding / captions) — with
    en fallback and {param} interpolation."""
    def dig(root):
        cur = (root or {}).get('tenant_dashboard', {}).get('email_auth', {})
        for part in subpath.split('.'):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                return None
        return cur if isinstance(cur, str) else None

    val = dig(_load_locale(project_root, lang))
    if val is None and lang != 'en':
        val = dig(_load_locale(project_root, 'en'))
    if val is None:
        val = subpath
    if params:
        for k, v in params.items():
            val = val.replace('{' + k + '}', str(v))
    return val


def mechanism_rows(findings, project_root, lang):
    """Localized (mechanism, status, detail) tuples for the seven scored
    mechanisms present in `findings`, in a deterministic order. DKIM is
    three-state — the localized status label renders 'indeterminate' honestly,
    never as a failure. Caller builds the table with its own cell styles."""
    out = []
    for m in ('spf', 'dkim', 'dmarc', 'mx', 'dnssec', 'mta_sts', 'tls_rpt'):
        fin = (findings or {}).get(m)
        if not fin:
            continue
        out.append((
            email_auth_label(project_root, lang, 'mech.' + m),
            email_auth_label(project_root, lang, 'status.' + (fin.get('status') or 'unknown')),
            email_auth_label(project_root, lang, 'finding.' + (fin.get('detail_key') or ''),
                             fin.get('detail_params') or {}),
        ))
    return out


def generate_email_auth_gauge(score, grade, output_buf, grade_word='Grade'):
    """Grade-banded donut gauge for one email-auth domain: score arc coloured by
    letter grade, score centred, localized 'Grade X' beneath. Square / no-stretch
    (embed at equal width=height). Returns False when there's no score."""
    if score is None:
        return False
    try:
        score = max(0, min(100, int(round(float(score)))))
    except (ValueError, TypeError):
        return False
    g = (grade or 'F').strip().upper()[:1] or 'F'
    color = EA_GRADE_COLORS.get(g, '#CC4444')

    # Lazy import: only the gauge needs matplotlib. use('Agg') is a no-op when the
    # caller (posture / QA generator) already set the headless backend.
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(2.5, 2.5))
    remaining = 100 - score
    ax.pie([score, remaining], colors=[color, '#E8E8E8'],
           startangle=90, counterclock=False,
           wedgeprops=dict(width=0.3, edgecolor='white', linewidth=2))
    ax.set_aspect('equal')
    ax.text(0, 0.10, f'{score}', ha='center', va='center',
            fontsize=22, fontweight='bold', color=_SCORE_TEXT_COLOR)
    ax.text(0, -0.20, f'{grade_word} {g}', ha='center', va='center',
            fontsize=10, fontweight='bold', color=color)

    plt.tight_layout()
    fig.savefig(output_buf, format='png', dpi=150, bbox_inches='tight',
                facecolor='white', edgecolor='none')
    plt.close(fig)
    return True
