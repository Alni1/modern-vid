// Likes, subscriptions, the "Save to playlist" dialog, playlist editing and chapter links.
(function () {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  /** JSON request; a guest is sent to the sign-in page and back. */
  async function api(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) {
      location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
      throw new Error('Sign in required');
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || data.message || 'Something went wrong');
    return data;
  }

  const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n || 0));

  function toast(text) {
    let t = $('#socialToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'socialToast';
      t.className = 'social-toast';
      t.setAttribute('role', 'status');
      document.body.append(t);
    }
    t.textContent = text;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => (t.hidden = true), 2600);
  }

  // ---------------------------------------------------------------- subscribe
  $$('[data-subscribe]').forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.dataset.subscribe;
    const on = btn.getAttribute('aria-pressed') === 'true';
    btn.disabled = true;
    try {
      const r = await api(on ? 'DELETE' : 'POST', `/api/channels/${id}/subscribe`);
      $$(`[data-subscribe="${id}"]`).forEach((b) => {
        b.setAttribute('aria-pressed', String(r.subscribed));
        b.classList.toggle('is-on', r.subscribed);
        b.textContent = r.subscribed ? 'Subscribed' : 'Subscribe';
      });
      $$(`[data-subscribers="${id}"]`).forEach((s) => (s.textContent = r.subscribers));
      toast(r.subscribed ? 'Subscribed: new videos of this channel appear in Subscriptions' : 'Subscription removed');
    } catch (err) {
      if (err.message !== 'Sign in required') toast(err.message);
    } finally {
      btn.disabled = false;
    }
  }));

  // ---------------------------------------------------------------- like
  $$('[data-like]').forEach((btn) => btn.addEventListener('click', async () => {
    const on = btn.getAttribute('aria-pressed') === 'true';
    btn.disabled = true;
    try {
      const r = await api(on ? 'DELETE' : 'POST', `/api/videos/${btn.dataset.like}/like`);
      btn.setAttribute('aria-pressed', String(r.liked));
      btn.classList.toggle('is-on', r.liked);
      $('[data-likes]', btn).textContent = compact(r.likes);
    } catch (err) {
      if (err.message !== 'Sign in required') toast(err.message);
    } finally {
      btn.disabled = false;
    }
  }));

  // ---------------------------------------------------------------- save to playlist
  const saveBtn = $('[data-save]');
  if (saveBtn) {
    const dialog = document.createElement('dialog');
    dialog.className = 'save-dialog';
    dialog.setAttribute('aria-labelledby', 'saveTitle');
    dialog.innerHTML =
      '<div class="save-head"><h2 id="saveTitle">Save to…</h2><button type="button" class="save-close" aria-label="Close">✕</button></div>' +
      '<ul class="save-list" aria-label="Your playlists"></ul>' +
      '<form class="save-new"><input type="text" name="title" maxlength="100" required placeholder="New playlist name" aria-label="New playlist name" />' +
      '<select name="visibility" aria-label="Visibility"><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select>' +
      '<button type="submit">Create</button></form><p class="save-error" role="alert" hidden></p>';
    document.body.append(dialog);
    const list = $('.save-list', dialog);
    const error = $('.save-error', dialog);
    const video = saveBtn.dataset.save;
    const showError = (msg) => {
      error.textContent = msg;
      error.hidden = !msg;
    };
    const render = (items) => {
      list.replaceChildren(...items.map((pl) => {
        const li = document.createElement('li');
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = pl.contains;
        box.addEventListener('change', async () => {
          box.disabled = true;
          try {
            await api(box.checked ? 'POST' : 'DELETE', box.checked ? `/api/playlists/${pl.id}/videos` : `/api/playlists/${pl.id}/videos/${video}`, box.checked ? { video } : undefined);
            toast(box.checked ? `Saved to “${pl.title}”` : `Removed from “${pl.title}”`);
          } catch (err) {
            box.checked = !box.checked;
            showError(err.message);
          } finally {
            box.disabled = false;
          }
        });
        const name = document.createElement('span');
        name.textContent = pl.title;
        const vis = document.createElement('small');
        vis.textContent = pl.visibility === 'public' ? 'Public' : pl.visibility === 'unlisted' ? 'Unlisted' : 'Private';
        label.append(box, name, vis);
        li.append(label);
        return li;
      }));
      if (!items.length) {
        const li = document.createElement('li');
        li.className = 'save-empty';
        li.textContent = 'No playlists yet: create the first one below.';
        list.append(li);
      }
    };
    saveBtn.addEventListener('click', async () => {
      showError('');
      try {
        render(await api('GET', `/api/playlists?video=${video}`));
        dialog.showModal();
      } catch (err) {
        if (err.message !== 'Sign in required') toast(err.message);
      }
    });
    $('.save-close', dialog).addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
    $('.save-new', dialog).addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      showError('');
      try {
        const data = Object.fromEntries(new FormData(form));
        await api('POST', '/api/playlists', { ...data, video });
        form.reset();
        render(await api('GET', `/api/playlists?video=${video}`));
        toast(`Saved to “${data.title}”`);
      } catch (err) {
        showError(err.message);
      }
    });
  }

  // ---------------------------------------------------------------- chapters on the watch page
  $$('[data-seek]').forEach((b) => b.addEventListener('click', () => {
    const player = $('mv-player');
    if (!player || !player.core) return;
    player.core.seek(Number(b.dataset.seek));
    player.play();
    player.scrollIntoView({ behavior: 'smooth', block: 'center' });
    player.focus({ preventScroll: true });
  }));

  // ---------------------------------------------------------------- playlists page and a playlist
  const plError = $('#plError');
  const plFail = (err) => {
    if (!plError) return toast(err.message);
    plError.textContent = err.message;
    plError.hidden = false;
  };
  const create = $('#plCreate');
  if (create) create.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const pl = await api('POST', '/api/playlists', Object.fromEntries(new FormData(create)));
      location.href = `/playlist/${pl.id}`;
    } catch (err) {
      plFail(err);
    }
  });

  const page = $('.pl-page');
  if (page) {
    const id = page.dataset.playlist;
    const edit = $('#plEdit');
    if (edit) edit.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PATCH', `/api/playlists/${id}`, Object.fromEntries(new FormData(edit)));
        location.reload();
      } catch (err) {
        plFail(err);
      }
    });
    const del = $('#plDelete');
    if (del) del.addEventListener('click', async () => {
      if (!confirm('Delete this playlist? The videos themselves stay.')) return;
      try {
        await api('DELETE', `/api/playlists/${id}`);
        location.href = '/playlists';
      } catch (err) {
        plFail(err);
      }
    });
    $$('.pl-row').forEach((row) => {
      const video = row.dataset.video;
      const remove = $('[data-remove]', row);
      if (remove) remove.addEventListener('click', async () => {
        try {
          await api('DELETE', `/api/playlists/${id}/videos/${video}`);
          location.reload();
        } catch (err) {
          plFail(err);
        }
      });
      $$('[data-move]', row).forEach((b) => b.addEventListener('click', async () => {
        try {
          await api('POST', `/api/playlists/${id}/videos/${video}/move`, { direction: b.dataset.move });
          location.reload();
        } catch (err) {
          plFail(err);
        }
      }));
    });
  }

  $$('[data-copy-link]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Link copied');
    } catch {
      toast(location.href);
    }
  }));
})();
