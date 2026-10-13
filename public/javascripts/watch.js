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

  // Comments
  const form = $('#commentForm');
  if (!form) return;
  const text = $('#commentText');
  const actions = form.querySelector('.comment-new-actions');
  const submit = $('#commentSubmit');
  const autosize = () => {
    text.style.height = 'auto';
    text.style.height = text.scrollHeight + 'px';
  };
  text.addEventListener('focus', () => (actions.hidden = false));
  text.addEventListener('input', () => {
    submit.disabled = !text.value.trim();
    autosize();
  });
  $('#commentCancel').addEventListener('click', () => {
    text.value = '';
    autosize();
    submit.disabled = true;
    actions.hidden = true;
  });

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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = text.value.trim();
    if (!value) return;
    submit.disabled = true;
    try {
      const res = await fetch(`/comments/${form.dataset.videoId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || res.statusText);
      const comment = await res.json();
      const li = document.createElement('li');
      li.className = 'comment comment-fresh';
      const body = document.createElement('div');
      const head = document.createElement('p');
      head.className = 'comment-head';
      const name = document.createElement('strong');
      name.textContent = comment.user ? comment.user.username : 'You';
      const when = document.createElement('span');
      when.textContent = 'just now';
      head.append(name, ' ', when);
      const p = document.createElement('p');
      p.className = 'comment-text';
      p.textContent = comment.text; // textContent: no HTML injection
      body.append(head, p);
      li.append(avatar(comment.user), body);
      $('#commentsList').prepend(li);
      $('#noComments')?.remove();
      const count = $('#commentCount');
      count.textContent = String(Number(count.textContent) + 1);
      text.value = '';
      autosize();
      actions.hidden = true;
    } catch (err) {
      notify('Could not post the comment' + (err.message ? ': ' + err.message : ''));
      submit.disabled = false;
    }
  });
})();
