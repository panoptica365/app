/**
 * Panoptica365 — Learn page
 *
 * Two in-page views (index = topic cards, topic = lesson cards) plus a large
 * near-fullscreen lesson modal. Mirrors the Settings card → sub-view pattern.
 * Read-only: it browses the curriculum and records per-user "viewed" state.
 *
 * Blue dot / UPDATED badge are driven entirely by the API responses; opening
 * a lesson POSTs a view, and closing the modal re-fetches the topic so the
 * dot clears (and disappears from the topic card on the way back to index).
 */
(function () {
  'use strict';

  let currentTopic = null;
  let pendingView = null;

  function lang() {
    return (window.PanopticaI18n && window.PanopticaI18n.currentLang &&
      window.PanopticaI18n.currentLang()) || 'en';
  }
  function localeTag() {
    const l = lang();
    return l === 'fr' ? 'fr-CA' : l === 'es' ? 'es' : 'en-CA';
  }
  function t(key, params) {
    return (window.t ? window.t(key, params) : key);
  }
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function iconHtml(name) {
    // name is a Lucide icon slug from authored content; restrict to a safe charset.
    const safe = /^[a-z0-9-]+$/.test(name || '') ? name : 'book-open';
    return '<i data-lucide="' + safe + '"></i>';
  }
  function fmtDate(s) {
    if (!s) return '';
    const d = new Date(s + 'T00:00:00');
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString(localeTag(), { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // The light/dark theme to hand the lesson iframe. Ground truth is the theme
  // stylesheet ACTUALLY applied to the shell (the <link id="theme-css"> href) —
  // not PanopticaTheme.currentPref(), which reads the friendly prefs key. That
  // key isn't written when the theme is applied from the saved DB pref on load
  // (only the stylesheet + STORAGE_KEY flip), so currentPref() reported 'dark'
  // on a light shell and the first lesson opened dark until prefs were re-saved.
  function currentLessonTheme() {
    try {
      const link = document.getElementById('theme-css');
      const href = (link && link.href) || '';
      if (/panoptica-light/.test(href)) return 'light';
      if (/panoptica-dark/.test(href)) return 'dark';
    } catch (e) { /* ignore — fall through to the storage-keyed fallbacks */ }
    try {
      if (window.PanopticaTheme) {
        if (window.PanopticaTheme.current && window.PanopticaTheme.current() === 'panoptica-light') return 'light';
        if (window.PanopticaTheme.currentPref && window.PanopticaTheme.currentPref() === 'light') return 'light';
      }
    } catch (e) { /* ignore */ }
    return 'dark';
  }

  // ─── Init / teardown ───
  function init(params) {
    document.getElementById('learn-back')?.addEventListener('click', showIndex);
    document.getElementById('learn-modal-close')?.addEventListener('click', closeModal);
    const overlay = document.getElementById('learn-modal-overlay');
    overlay?.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', onKeydown);

    if (params && params.topic) showTopic(params.topic);
    else showIndex();
  }

  function destroy() {
    document.removeEventListener('keydown', onKeydown);
  }

  function onKeydown(e) {
    if (e.key !== 'Escape') return;
    const overlay = document.getElementById('learn-modal-overlay');
    if (overlay && overlay.classList.contains('active')) closeModal();
  }

  // ─── Card rendering ───
  function dotHtml(hasUnread) {
    return hasUnread
      ? '<span class="learn-dot" title="' + esc(t('learn.unread')) + '"></span>'
      : '';
  }
  function badgeHtml(hasRecent) {
    return hasRecent
      ? '<span class="learn-badge">' + esc(t('learn.updated_badge')) + '</span>'
      : '';
  }

  function renderTopicCard(topic) {
    return (
      '<div class="settings-card learn-card" data-topic="' + esc(topic.slug) + '" style="cursor:pointer;">' +
        dotHtml(topic.has_unread) +
        '<div class="settings-card-icon">' + iconHtml(topic.icon) + '</div>' +
        '<div class="learn-card-titlerow">' +
          '<div class="settings-card-title">' + esc(topic.title) + '</div>' +
          badgeHtml(topic.has_recent_update) +
        '</div>' +
        '<div class="settings-card-desc">' + esc(topic.subtitle) + '</div>' +
      '</div>'
    );
  }

  function renderLessonCard(lesson) {
    const footer = lesson.last_updated
      ? '<div class="learn-card-footer">' + esc(t('learn.last_updated')) + ' ' + esc(fmtDate(lesson.last_updated)) + '</div>'
      : '';
    return (
      '<div class="settings-card learn-card" data-lesson="' + esc(lesson.slug) + '" data-topic="' + esc(currentTopic) + '" style="cursor:pointer;">' +
        dotHtml(lesson.has_unread) +
        '<div class="settings-card-icon">' + iconHtml(lesson.icon) + '</div>' +
        '<div class="learn-card-titlerow">' +
          '<div class="settings-card-title">' + esc(lesson.title) + '</div>' +
          badgeHtml(lesson.has_recent_update) +
        '</div>' +
        '<div class="settings-card-desc">' + esc(lesson.subtitle) + '</div>' +
        footer +
      '</div>'
    );
  }

  function loadingHtml() {
    return '<div class="loading-container"><div class="loading-spinner"></div></div>';
  }
  function errorHtml() {
    return '<div class="panel-error">' + esc(t('common.page_load_failed')) + '</div>';
  }

  // ─── Index view ───
  async function showIndex() {
    currentTopic = null;
    document.getElementById('learn-topic-view').style.display = 'none';
    document.getElementById('learn-index-view').style.display = '';
    const grid = document.getElementById('learn-topic-grid');
    grid.innerHTML = loadingHtml();
    try {
      const data = await Panoptica.api('/api/learn/topics?lang=' + encodeURIComponent(lang()));
      const topics = data.topics || [];
      grid.innerHTML = topics.map(renderTopicCard).join('');
      Panoptica.refreshIcons(grid);
      grid.querySelectorAll('[data-topic]').forEach((el) =>
        el.addEventListener('click', () => showTopic(el.dataset.topic))
      );
    } catch (e) {
      grid.innerHTML = errorHtml();
    }
  }

  // ─── Topic view ───
  async function showTopic(slug) {
    currentTopic = slug;
    document.getElementById('learn-index-view').style.display = 'none';
    document.getElementById('learn-topic-view').style.display = '';
    window.scrollTo(0, 0);
    await loadLessons(slug, false);
  }

  async function loadLessons(slug, silent) {
    const grid = document.getElementById('learn-lesson-grid');
    const empty = document.getElementById('learn-lesson-empty');
    if (!silent) {
      grid.innerHTML = loadingHtml();
      empty.style.display = 'none';
    }
    try {
      const data = await Panoptica.api(
        '/api/learn/topics/' + encodeURIComponent(slug) + '/lessons?lang=' + encodeURIComponent(lang())
      );
      const topic = data.topic || {};
      document.getElementById('learn-topic-title').textContent = topic.title || '';
      document.getElementById('learn-topic-subtitle').textContent = topic.subtitle || '';
      const iconWrap = document.getElementById('learn-topic-icon');
      if (iconWrap) iconWrap.innerHTML = iconHtml(topic.icon);

      const lessons = data.lessons || [];
      if (!lessons.length) {
        grid.innerHTML = '';
        empty.style.display = '';
      } else {
        empty.style.display = 'none';
        grid.innerHTML = lessons.map(renderLessonCard).join('');
      }
      Panoptica.refreshIcons(document.getElementById('learn-topic-view'));
      grid.querySelectorAll('[data-lesson]').forEach((el) =>
        el.addEventListener('click', () => openLesson(el.dataset.topic, el.dataset.lesson))
      );
    } catch (e) {
      if (!silent) grid.innerHTML = errorHtml();
    }
  }

  // ─── Lesson modal ───
  function openLesson(topicSlug, lessonSlug) {
    const overlay = document.getElementById('learn-modal-overlay');
    const body = document.getElementById('learn-modal-body');
    const titleEl = document.getElementById('learn-modal-title');
    const lessonId = topicSlug + '/' + lessonSlug;

    titleEl.textContent = '';
    body.innerHTML = loadingHtml();
    overlay.classList.add('active');
    document.getElementById('learn-modal-close')?.focus();

    // Mark viewed on open. Keep the promise so closeModal can await it before
    // re-fetching the lesson list (so the blue dot clears reliably).
    pendingView = Panoptica.api('/api/learn/views', {
      method: 'POST',
      body: JSON.stringify({ lesson_id: lessonId }),
    }).catch(() => {});

    Panoptica.api(
      '/api/learn/lessons/' + encodeURIComponent(topicSlug) + '/' + encodeURIComponent(lessonSlug) + '?lang=' + encodeURIComponent(lang())
    ).then((data) => {
      titleEl.textContent = data.title || '';

      // The lesson is a standalone HTML doc served from /learn-assets. Render it
      // in a sandboxed iframe (allow-same-origin only — NO allow-scripts; the
      // lessons run no JS). The iframe FILLS the modal body and scrolls its own
      // content — one native scrollbar. (We deliberately do NOT auto-size the
      // frame to its content height: that left the frame a hair short, so it
      // kept an inner scrollbar while the modal body scrolled the rest — the
      // jumpy double-scrollbar.) Same-origin lets us inject the light/dark theme.
      const frame = document.createElement('iframe');
      frame.className = 'learn-lesson-frame';
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.setAttribute('title', data.title || '');
      frame.src = data.html_url;

      frame.addEventListener('load', () => {
        try {
          frame.contentDocument.documentElement.setAttribute('data-theme', currentLessonTheme()); // 'light' | 'dark'
        } catch (e) { /* same-origin; should not throw */ }
      });

      body.innerHTML = '';
      body.appendChild(frame);
    }).catch(() => {
      body.innerHTML = errorHtml();
    });
  }

  async function closeModal() {
    const overlay = document.getElementById('learn-modal-overlay');
    if (!overlay || !overlay.classList.contains('active')) return;
    overlay.classList.remove('active');
    document.getElementById('learn-modal-body').innerHTML = '';
    // Ensure the view is recorded, then refresh the lesson list so the dot
    // clears on the card we just read (and the topic card on the way back).
    try { await pendingView; } catch (e) { /* ignore */ }
    pendingView = null;
    if (currentTopic) loadLessons(currentTopic, true);
  }

  window.PanopticaPage = { init, destroy };
})();
