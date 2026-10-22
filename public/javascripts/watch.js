// Watch page: processing status, player settings sync, description, comments, share.
(function () {
  const $ = (sel) => document.querySelector(sel);
  const toast = $('#toast');
  let toastTimer = 0;
  const notify = (text) => {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 2400);
  };

  // While the video is being transcoded, poll its status and reload when it is ready.
  const processingBox = $('#processingBox');
  if (processingBox) {
    const id = processingBox.dataset.videoId;
    const poll = async () => {
      try {
        const res = await fetch(`/player/status/${id}`);
        const data = await res.json();
        const pct = Math.round((data.progress || 0) * 100);
        $('#processingFill').style.width = pct + '%';
        $('#processingText').textContent = pct + '%';
        if (data.status !== 'processing') return location.reload();
      } catch { /* try again later */ }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 3000);
  }

  // Theater mode: the player switches it, the page widens the layout.
  const playerEl = $('#my-player');
  const watchLayout = $('.watch');
  if (playerEl && watchLayout) {
    const syncTheater = () => watchLayout.classList.toggle('is-theater', playerEl.hasAttribute('theater'));
    playerEl.addEventListener('mv-theater', syncTheater);
    if (window.customElements) customElements.whenDefined('mv-player').then(syncTheater);
  }

  // Player settings of a signed-in viewer are saved on the server (debounced),
  // so they follow the viewer to other browsers and devices.
  const player = $('#my-player');
  if (player && player.hasAttribute('preset')) {
    let saveTimer = 0;
    player.addEventListener('mv-preset-change', (e) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        fetch('/api/presets/me', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preset: e.detail.preset }),
        }).catch(() => { /* the preset stays in the browser and is sent with the next change */ });
      }, 800);
    });
  }

  // Watch analytics: how long the video is played and which parts of it (1 % buckets).
  // Reported every 15 s while something changes and when the page is hidden or closed.
  if (player && player.dataset.videoId) {
    const BUCKETS = 100;
    const session = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9-]/g, '');
    let lastSent = '';
    const report = () => {
      const media = player.media;
      const qoe = player.qoe && player.qoe();
      if (!media || !qoe || !(media.duration > 0)) return;
      const watched = Math.round(qoe.playTime * 10) / 10;
      // A bucket counts as watched when at least half of it was played.
      const size = media.duration / BUCKETS;
      const covered = new Array(BUCKETS).fill(0);
      for (let r = 0; r < media.played.length; r++) {
        const start = media.played.start(r);
        const end = media.played.end(r);
        for (let b = Math.floor(start / size); b < BUCKETS && b * size < end; b++) {
          covered[b] += Math.min(end, (b + 1) * size) - Math.max(start, b * size);
        }
      }
      const buckets = [];
      covered.forEach((t, b) => { if (t >= size / 2) buckets.push(b); });
      const body = JSON.stringify({ video: player.dataset.videoId, session, watched, buckets });
      if (watched <= 0 || body === lastSent) return;
      lastSent = body;
      const blob = new Blob([body], { type: 'application/json' });
      if (!(navigator.sendBeacon && navigator.sendBeacon('/api/analytics/session', blob))) {
        fetch('/api/analytics/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
      }
    };
    setInterval(report, 15000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') report(); });
    window.addEventListener('pagehide', report);
  }

  // Share
  $('#shareBtn')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(location.href).then(() => notify('Link copied'), () => notify(location.href));
  });

  // Long descriptions are collapsed to a few lines.
  const descText = $('#descText');
  const descMore = $('#descMore');
  if (descText && descMore) {
    descText.classList.add('is-collapsed');
    if (descText.scrollHeight > descText.clientHeight + 4) {
      descMore.hidden = false;
      descMore.addEventListener('click', () => {
        const collapsed = descText.classList.toggle('is-collapsed');
        descMore.textContent = collapsed ? 'Show more' : 'Show less';
      });
    } else {
      descText.classList.remove('is-collapsed');
    }
  }

  // ------------------------------------------------------------------ reports
  const dialog = $('#reportDialog');
  if (dialog) {
    const rform = $('#reportForm');
    const rerr = $('#reportError');
    let target = null;
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-report]');
      if (!btn) return;
      const type = btn.dataset.report;
      const id = type === 'video' ? btn.dataset.target : btn.closest('.comment')?.dataset.id;
      if (!id) return;
      target = { targetType: type, target: id };
      $('#reportTitle').textContent = type === 'video' ? 'Report video' : 'Report comment';
      rform.reset();
      rerr.hidden = true;
      dialog.showModal();
    });
    $('#reportCancel').addEventListener('click', () => dialog.close());
    rform.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(rform);
      if (!data.get('reason')) { rerr.textContent = 'Choose a reason.'; rerr.hidden = false; return; }
      const submitBtn = $('#reportSubmit');
      submitBtn.disabled = true;
      try {
        const res = await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ ...target, reason: data.get('reason'), note: data.get('note') || '' }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || res.statusText);
        dialog.close();
        notify('Thank you. Moderators will review it.');
      } catch (err) {
        rerr.textContent = 'Could not send the report: ' + err.message;
        rerr.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------------ comments
  const list = $('#commentsList');
  if (!list) return;
  const count = $('#commentCount');
  const setCount = (n) => {
    count.textContent = String(n);
    $('#commentWord').textContent = n === 1 ? 'comment' : 'comments';
    $('#noComments').hidden = n > 0;
  };

  // Long comments are collapsed to a few lines with "Read more".
  const clamp = (li) => {
    const p = li.querySelector('.comment-text');
    const more = li.querySelector('.comment-more');
    p.classList.add('is-collapsed');
    if (p.scrollHeight > p.clientHeight + 4) {
      more.hidden = false;
      more.onclick = () => {
        const collapsed = p.classList.toggle('is-collapsed');
        more.textContent = collapsed ? 'Read more' : 'Show less';
      };
    } else {
      p.classList.remove('is-collapsed');
    }
  };
  list.querySelectorAll('.comment').forEach(clamp);

  // Delete (own comments, or any comment on the viewer's own video) with an inline confirmation.
  list.addEventListener('click', async (e) => {
    const del = e.target.closest('.comment-delete');
    if (!del) return;
    const li = del.closest('.comment');
    if (!li.classList.contains('is-confirming')) {
      li.classList.add('is-confirming');
      const bar = document.createElement('div');
      bar.className = 'comment-confirm';
      bar.innerHTML = '<span>Delete this comment?</span><button type="button" class="site-btn site-btn-quiet" data-act="no">Cancel</button><button type="button" class="site-btn site-btn-danger" data-act="yes">Delete</button>';
      li.querySelector('.comment-body').append(bar);
      bar.querySelector('[data-act=yes]').focus();
      bar.addEventListener('click', async (ev) => {
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (act === 'no') { bar.remove(); li.classList.remove('is-confirming'); del.focus(); }
        if (act !== 'yes') return;
        ev.target.disabled = true;
        try {
          const res = await fetch(`/comments/${li.dataset.id}`, { method: 'DELETE' });
          if (!res.ok && res.status !== 404) throw new Error((await res.json().catch(() => ({}))).message || res.statusText);
          li.classList.add('comment-leaving');
          setTimeout(() => li.remove(), 180);
          setCount(Math.max(0, Number(count.textContent) - 1));
          notify('Comment deleted');
        } catch (err) {
          ev.target.disabled = false;
          notify('Could not delete the comment' + (err.message ? ': ' + err.message : ''));
        }
      });
    }
  });

  const form = $('#commentForm');
  if (!form) return;
  const text = $('#commentText');
  const actions = form.querySelector('.comment-new-actions');
  const submit = $('#commentSubmit');
  const counter = $('#commentCounter');
  const MAX = Number(text.getAttribute('maxlength')) || 1000;
  const autosize = () => {
    text.style.height = 'auto';
    text.style.height = text.scrollHeight + 'px';
  };
  const update = () => {
    const len = text.value.length;
    submit.disabled = !text.value.trim();
    counter.hidden = len < MAX * 0.8;
    counter.textContent = `· ${len}/${MAX}`;
    counter.classList.toggle('is-full', len >= MAX);
    autosize();
  };
  const reset = () => {
    text.value = '';
    update();
    actions.hidden = true;
    text.blur();
  };
  text.addEventListener('focus', () => (actions.hidden = false));
  text.addEventListener('input', update);
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
    if (e.key === 'Escape' && !text.value) reset();
  });
  $('#commentCancel').addEventListener('click', reset);

  const avatar = (user) => {
    const span = document.createElement('span');
    span.className = 'watch-avatar watch-avatar-sm';
    span.setAttribute('aria-hidden', 'true');
    if (user && user.avatarUrl) {
      const img = document.createElement('img');
      img.src = user.avatarUrl;
      img.alt = '';
      span.append(img);
    } else {
      span.textContent = ((user && user.username) || '?').trim().charAt(0).toUpperCase();
    }
    return span;
  };

  /** Builds a comment like the server template (textContent only: no HTML injection). */
  const renderComment = (c) => {
    const li = document.createElement('li');
    li.className = 'comment comment-fresh';
    li.dataset.id = c._id;
    const body = document.createElement('div');
    body.className = 'comment-body';
    const head = document.createElement('p');
    head.className = 'comment-head';
    const name = document.createElement(c.user && c.user._id ? 'a' : 'strong');
    if (c.user && c.user._id) name.href = `/channel/${c.user._id}`;
    name.className = 'comment-name' + (c.byAuthor ? ' is-author' : '');
    name.textContent = c.user ? c.user.username : 'You';
    head.append(name, ' ');
    if (c.byAuthor) {
      const badge = document.createElement('span');
      badge.className = 'comment-badge';
      badge.textContent = 'Author';
      head.append(badge, ' ');
    }
    const when = document.createElement('time');
    when.dateTime = c.createdAt;
    when.title = new Date(c.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    when.textContent = 'just now';
    head.append(when);
    const p = document.createElement('p');
    p.className = 'comment-text';
    p.textContent = c.text;
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'comment-more';
    more.hidden = true;
    more.textContent = 'Read more';
    body.append(head, p, more);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'comment-delete';
    del.setAttribute('aria-label', 'Delete comment');
    del.title = 'Delete comment';
    del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
    del.classList.add('comment-tool');
    const tools = document.createElement('div');
    tools.className = 'comment-tools';
    tools.append(del);
    li.append(avatar(c.user), body, tools);
    return li;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = text.value.trim();
    if (!value) return;
    submit.disabled = true;
    try {
      const res = await fetch(`/comments/${form.dataset.videoId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ text: value }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || res.statusText);
      const li = renderComment(await res.json());
      list.prepend(li);
      clamp(li);
      setCount(Number(count.textContent) + 1);
      reset();
    } catch (err) {
      notify('Could not post the comment' + (err.message ? ': ' + err.message : ''));
      submit.disabled = false;
    }
  });
})();
