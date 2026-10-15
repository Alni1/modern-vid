// Profile page: tabs, video list tools, channel player theme editor, avatar and video upload.
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ---------------------------------------------------------------- toast
  const toast = $('#toast');
  let toastTimer = 0;
  function notify(text) {
    if (!toast) return;
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 2600);
  }

  // ---------------------------------------------------------------- tabs (hash: #videos, #theme, #account)
  const tabs = $$('.pf-tab');
  function showTab(name, focus) {
    if (!tabs.some((t) => t.dataset.tab === name)) name = 'videos';
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $('#' + t.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) t.focus();
    });
    if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => showTab(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      showTab(next.dataset.tab, true);
    });
  });
  const wantsUpload = location.hash === '#upload'; // header "Upload" button
  showTab(wantsUpload ? 'videos' : location.hash.slice(1) || 'videos');
  window.addEventListener('hashchange', () => {
    if (location.hash === '#upload') {
      showTab('videos');
      $('[data-open-upload]').click();
      return;
    }
    showTab(location.hash.slice(1));
  });

  // ---------------------------------------------------------------- confirmations
  $$('form[data-confirm]').forEach((form) =>
    form.addEventListener('submit', (e) => {
      if (!confirm(form.dataset.confirm)) e.preventDefault();
    }),
  );

  // ---------------------------------------------------------------- video list: filter, sort, copy link
  const grid = $('#videoGrid');
  if (grid) {
    const cards = $$('.pf-card', grid);
    const filter = $('#videoFilter');
    const sort = $('#videoSort');
    const noMatch = $('#noMatch');
    const apply = () => {
      const q = filter.value.trim().toLowerCase();
      let shown = 0;
      cards.forEach((c) => {
        const ok = !q || c.dataset.title.includes(q);
        c.hidden = !ok;
        if (ok) shown++;
      });
      noMatch.hidden = shown > 0;
      const key = sort.value;
      const sorted = [...cards].sort((a, b) => {
        if (key === 'views') return b.dataset.views - a.dataset.views;
        return key === 'old' ? a.dataset.date - b.dataset.date : b.dataset.date - a.dataset.date;
      });
      sorted.forEach((c) => grid.append(c));
    };
    filter.addEventListener('input', apply);
    sort.addEventListener('change', apply);
    apply();

    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-copy]');
      if (!btn) return;
      const url = location.origin + btn.dataset.copy;
      navigator.clipboard?.writeText(url).then(() => notify('Link copied'), () => notify(url));
    });
  }

  // ---------------------------------------------------------------- avatar: upload as soon as a file is chosen
  $$('.avatar-input').forEach((input) =>
    input.addEventListener('change', () => {
      if (!input.files.length) return;
      const img = $('#avatarImg');
      if (img && img.tagName === 'IMG') img.src = URL.createObjectURL(input.files[0]);
      notify('Uploading profile picture…');
      input.form.submit();
    }),
  );

  // ---------------------------------------------------------------- channel player theme
  const themeForm = $('#channelThemeForm');
  const preview = $('#themePreview');
  if (themeForm && preview) {
    const status = $('#channelThemeStatus');
    const outputs = {
      panelOpacity: (v) => Math.round(v * 100) + '%',
      radius: (v) => v + 'px',
    };
    const readTheme = () => {
      const d = new FormData(themeForm);
      return {
        accent: d.get('accent'),
        background: d.get('background'),
        foreground: d.get('foreground'),
        panelOpacity: Number(d.get('panelOpacity')),
        radius: Number(d.get('radius')),
        controlSize: d.get('controlSize'),
        fontFamily: d.get('fontFamily'),
      };
    };
    const refresh = () => {
      const theme = readTheme();
      preview.setAttribute('author-theme', JSON.stringify(theme));
      document.body.style.setProperty('--pf-accent', theme.accent);
      $$('output[data-for]', themeForm).forEach((o) => {
        const input = themeForm.elements[o.dataset.for];
        o.textContent = outputs[o.dataset.for](Number(input.value));
        const p = ((input.value - input.min) / (input.max - input.min)) * 100;
        input.style.setProperty('--p', p + '%');
      });
      $$('.pf-swatch', themeForm).forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.swatch === theme.accent)));
      status.textContent = '';
    };
    themeForm.addEventListener('input', refresh);
    themeForm.addEventListener('change', refresh);
    themeForm.addEventListener('click', (e) => {
      const sw = e.target.closest('.pf-swatch');
      if (!sw) return;
      themeForm.elements[sw.dataset.target].value = sw.dataset.swatch;
      refresh();
    });
    refresh();

    themeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      status.textContent = 'Saving…';
      try {
        const res = await fetch('/api/presets/channel', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme: readTheme() }),
        });
        status.textContent = res.ok ? 'Saved' : 'Could not save the theme';
        if (res.ok) notify('Channel theme saved');
      } catch {
        status.textContent = 'Could not save the theme';
      }
    });
    $('#channelThemeReset').addEventListener('click', async () => {
      const res = await fetch('/api/presets/channel', { method: 'DELETE' });
      if (res.ok) {
        location.hash = 'theme';
        location.reload();
      } else {
        status.textContent = 'Could not reset the theme';
      }
    });
  }

  // ---------------------------------------------------------------- upload dialog
  const dialog = $('#uploadDialog');
  const form = $('#videoUploadForm');
  const fileInput = $('#modalVideoFile');
  const drop = $('#dropZone');
  const submitBtn = $('#submitUploadBtn');
  const progress = $('#uploadProgress');
  const bar = $('#uploadProgressBar');
  const percent = $('#uploadPercent');
  const uploadStatus = $('#uploadStatus');
  let xhr = null;

  const formatSize = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB');
  const showFile = () => {
    const f = fileInput.files[0];
    drop.classList.toggle('pf-drop-filled', Boolean(f));
    $('#dropText').textContent = f ? f.name : 'Drop a video here or click to choose';
    $('#dropHint').textContent = f ? formatSize(f.size) + ' · click to choose another file' : $('#dropHint').dataset.default;
    const title = $('#modalTitle');
    if (f && !title.value) title.value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  };

  // The same dialog edits a published video (without a file): editId is the video being edited.
  let editId = null;
  const subsField = $('#subsField');
  const subsList = $('#subsList');
  const subsStatus = $('#subsStatus');
  const renderSubs = (subs) => {
    subsList.replaceChildren(...subs.map((s) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = `${s.label} (${s.lang})`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'pf-icon-btn';
      del.textContent = '✕';
      del.title = 'Delete subtitles';
      del.setAttribute('aria-label', `Delete subtitles ${s.label}`);
      del.addEventListener('click', async () => {
        const r = await fetch(`/api/videos/${editId}/subtitles/${s.lang}`, { method: 'DELETE', headers: { Accept: 'application/json' } });
        const body = await r.json().catch(() => ({}));
        if (r.ok) renderSubs(body.subtitles);
        else subsStatus.textContent = body.error || 'Could not delete the subtitles';
      });
      li.append(name, del);
      return li;
    }));
    if (!subs.length) subsList.innerHTML = '<li class="pf-muted">No subtitles yet.</li>';
  };
  $('#subsUpload').addEventListener('click', async () => {
    const file = $('#subsFile').files[0];
    if (!file) return (subsStatus.textContent = 'Choose a .vtt or .srt file');
    const data = new FormData();
    data.append('lang', $('#subsLang').value);
    data.append('label', $('#subsLang').selectedOptions[0].textContent);
    data.append('file', file);
    subsStatus.textContent = 'Uploading…';
    const r = await fetch(`/api/videos/${editId}/subtitles`, { method: 'POST', headers: { Accept: 'application/json' }, body: data });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return (subsStatus.textContent = body.error || 'Upload failed');
    $('#subsFile').value = '';
    subsStatus.textContent = `Added: ${body.cues} subtitles`;
    renderSubs(body.subtitles);
  });

  const setMode = (video) => {
    editId = video ? video.id : null;
    subsField.hidden = !video;
    subsStatus.textContent = '';
    if (video) renderSubs(video.subtitles || []);
    drop.hidden = Boolean(video);
    fileInput.required = !video;
    $('#uploadTitle').textContent = video ? 'Edit video' : 'Upload video';
    submitBtn.textContent = video ? 'Save' : 'Upload';
  };

  $$('[data-edit-video]').forEach((b) =>
    b.addEventListener('click', () => {
      const video = JSON.parse(b.closest('.pf-card').dataset.video);
      form.reset();
      setMode(video);
      $('#modalTitle').value = video.title;
      $('#modalDescription').value = video.description;
      $('#modalTags').value = video.tags;
      $('#modalChapters').value = video.chapters || '';
      form.querySelector(`input[name="category"][value="${video.category}"]`).checked = true;
      form.querySelector(`input[name="visibility"][value="${video.visibility}"]`).checked = true;
      progress.hidden = true;
      uploadStatus.textContent = '';
      submitBtn.disabled = false;
      dialog.showModal();
    }),
  );

  $$('[data-open-upload]').forEach((b) =>
    b.addEventListener('click', () => {
      form.reset();
      setMode(null);
      showFile();
      progress.hidden = true;
      uploadStatus.textContent = '';
      submitBtn.disabled = false;
      dialog.showModal();
    }),
  );
  const closeDialog = () => {
    if (xhr && !confirm('Cancel the upload?')) return;
    if (xhr) xhr.abort();
    dialog.close();
  };
  $$('[data-close-upload]').forEach((b) => b.addEventListener('click', closeDialog));
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeDialog();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog(); // click on the backdrop
  });

  fileInput.addEventListener('change', showFile);
  ['dragenter', 'dragover'].forEach((t) =>
    drop.addEventListener(t, (e) => {
      e.preventDefault();
      drop.classList.add('pf-drop-over');
    }),
  );
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('pf-drop-over')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f || !f.type.startsWith('video/')) return notify('Please drop a video file');
    const dt = new DataTransfer();
    dt.items.add(f);
    fileInput.files = dt.files;
    showFile();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (editId) {
      submitBtn.disabled = true;
      uploadStatus.textContent = 'Saving…';
      const data = Object.fromEntries(new FormData(form));
      delete data.video;
      delete data.subsFile;
      try {
        const r = await fetch(`/userprofile/video/${editId}/edit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(data),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Could not save the changes');
        uploadStatus.textContent = 'Saved';
        setTimeout(() => location.reload(), 400);
      } catch (err) {
        uploadStatus.textContent = err.message;
        submitBtn.disabled = false;
      }
      return;
    }
    if (!fileInput.files.length) return notify('Choose a video file first');
    submitBtn.disabled = true;
    progress.hidden = false;
    uploadStatus.textContent = 'Uploading…';

    xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload', true);
    xhr.setRequestHeader('Accept', 'application/json');
    const started = performance.now();
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const p = Math.round((ev.loaded / ev.total) * 100);
      const seconds = (performance.now() - started) / 1000;
      const speed = seconds > 0.5 ? ` · ${(ev.loaded / seconds / 1e6).toFixed(1)} MB/s` : '';
      bar.style.width = p + '%';
      percent.textContent = p + '%' + speed;
      if (p === 100) uploadStatus.textContent = 'Checking the file…';
    };
    xhr.onload = () => {
      const req = xhr;
      const done = req.status === 201;
      xhr = null;
      if (done) {
        uploadStatus.textContent = 'Uploaded! The video is being prepared — it will appear in a moment.';
        setTimeout(() => location.reload(), 1500);
        return;
      }
      submitBtn.disabled = false;
      progress.hidden = true;
      let msg = 'Upload failed';
      try {
        msg += ': ' + (JSON.parse(req.responseText || '{}').error || '');
      } catch {}
      uploadStatus.textContent = msg;
    };
    xhr.onerror = () => {
      xhr = null;
      submitBtn.disabled = false;
      progress.hidden = true;
      uploadStatus.textContent = 'Upload failed: network error';
    };
    xhr.onabort = () => {
      xhr = null;
      submitBtn.disabled = false;
    };
    xhr.send(new FormData(form));
  });

  if (wantsUpload) $('[data-open-upload]').click();

  // ---------------------------------------------------------------- account: name, login, password
  const settings = document.getElementById('accountSettings');
  if (settings) {
    const close = (form) => {
      form.hidden = true;
      form.reset();
      form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
      form.querySelector('.pf-edit-error').hidden = true;
    };
    settings.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
      settings.querySelectorAll('.pf-edit').forEach((f) => f !== btn && close(f));
      const form = settings.querySelector(`[data-form="${btn.dataset.edit}"]`);
      form.hidden = false;
      form.querySelector('input').focus();
    }));
    settings.querySelectorAll('.pf-edit').forEach((form) => {
      const error = form.querySelector('.pf-edit-error');
      form.querySelector('[data-cancel]').addEventListener('click', () => close(form));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submit = form.querySelector('[type=submit]');
        form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
        error.hidden = true;
        submit.disabled = true;
        try {
          const res = await fetch(form.dataset.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(Object.fromEntries(new FormData(form))),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            error.textContent = data.error || 'Something went wrong.';
            error.hidden = false;
            const field = data.field && form.querySelector(`[name="${data.field}"]`);
            if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
            return;
          }
          if (data.username) {
            settings.querySelector('[data-value="username"]').textContent = data.username;
            const h = document.querySelector('.pf-name');
            if (h) h.textContent = data.username;
          }
          if (data.login) {
            settings.querySelector('[data-value="login"]').textContent = data.login;
            const l = document.getElementById('pfLogin');
            if (l) l.textContent = data.login;
          }
          close(form);
          if (data.username) form.querySelector('[name="username"]').defaultValue = data.username;
          notify(form.dataset.form === 'login' ? 'Login changed. Use it the next time you sign in.'
            : form.dataset.form === 'password' ? 'Password changed. Other devices are signed out.' : 'Display name changed.');
        } catch {
          error.textContent = 'Network error. Try again.';
          error.hidden = false;
        } finally {
          submit.disabled = false;
        }
      });
    });
  }
})();
