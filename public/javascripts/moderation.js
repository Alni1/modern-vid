// Moderation panel: reports queue, users and the action log (API: /api/moderation).
(function () {
  const root = document.getElementById('md');
  if (!root) return;
  const isAdmin = root.dataset.admin === '1';
  const REASONS = JSON.parse(root.dataset.reasons || '{}');
  const BAN_DAYS = JSON.parse(root.dataset.banDays || '[]');
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const toast = $('#toast');
  let toastTimer = 0;
  const notify = (text) => {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 2600);
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const until = (d) => (new Date(d).getFullYear() > 9000 ? 'permanently' : `until ${when(d)}`);
  const banLabel = (d) => (d === 0 ? 'Permanently' : d === 1 ? '1 day' : `${d} days`);

  async function api(path, body) {
    const res = await fetch('/api/moderation' + path, body === undefined
      ? { headers: { Accept: 'application/json' } }
      : { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  // ------------------------------------------------------------------ tabs
  const tabs = $$('.md-tab');
  const loaders = {};
  function showTab(name) {
    if (!tabs.some((t) => t.dataset.tab === name)) name = 'reports';
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $('#' + t.getAttribute('aria-controls')).hidden = !on;
    });
    history.replaceState(null, '', '#' + name);
    loaders[name] && loaders[name]();
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => showTab(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      showTab(next.dataset.tab);
      next.focus();
    });
  });

  // An inline form under a row: reason text, ban length, confirmation.
  function inlineForm(host, { label, needReason, banDays, confirmText, danger }, onSubmit) {
    $$('.md-inline', host.closest('.md-list') || document).forEach((f) => f.remove());
    const form = document.createElement('form');
    form.className = 'md-inline';
    form.innerHTML = `
      <p class="md-inline-title">${esc(label)}</p>
      ${banDays ? `<div class="md-days" role="radiogroup" aria-label="Length">${BAN_DAYS.map((d, i) => `
        <label><input type="radio" name="days" value="${d}"${i === 1 ? ' checked' : ''}> ${banLabel(d)}</label>`).join('')}</div>` : ''}
      ${needReason ? '<input type="text" name="reason" maxlength="300" required placeholder="Reason (shown to the author)" aria-label="Reason">' : ''}
      <div class="md-inline-actions">
        <button type="button" class="md-btn md-btn-quiet" data-cancel>Cancel</button>
        <button type="submit" class="md-btn ${danger ? 'md-btn-danger' : 'md-btn-primary'}">${esc(confirmText)}</button>
      </div>`;
    host.append(form);
    (form.querySelector('input[name=reason]') || form.querySelector('[type=submit]')).focus();
    form.querySelector('[data-cancel]').addEventListener('click', () => form.remove());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await onSubmit({ reason: (data.get('reason') || '').trim(), days: data.has('days') ? Number(data.get('days')) : undefined });
      } catch (err) {
        notify('Failed: ' + err.message);
        btn.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------------ reports
  let status = 'open';
  const reportsBox = $('#mdReports');
  $$('.md-seg [data-status]').forEach((b) => b.addEventListener('click', () => {
    status = b.dataset.status;
    $$('.md-seg [data-status]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    loadReports();
  }));

  function reasonChips(reports) {
    const n = {};
    reports.forEach((r) => (n[r.reason] = (n[r.reason] || 0) + 1));
    return Object.entries(n).sort((a, b) => b[1] - a[1])
      .map(([k, c]) => `<span class="md-chip">${esc(REASONS[k] || k)}${c > 1 ? ` × ${c}` : ''}</span>`).join('');
  }
  const outcome = { hidden: 'Hidden', deleted: 'Deleted', dismissed: 'Dismissed', gone: 'Deleted by the author' };

  function renderReports(groups) {
    if (!groups.length) {
      reportsBox.innerHTML = `<p class="md-empty">${status === 'open' ? 'No open reports. Nice and quiet.' : 'No handled reports yet.'}</p>`;
      return;
    }
    reportsBox.innerHTML = `<ul class="md-list">${groups.map((g, i) => `
      <li class="md-item${g.exists ? '' : ' is-gone'}" data-i="${i}">
        <div class="md-target">
          ${g.targetType === 'video'
            ? `${g.thumbnailUrl ? `<img src="${esc(g.thumbnailUrl)}" alt="" class="md-thumb">` : '<span class="md-thumb md-thumb-empty"></span>'}`
            : '<span class="md-thumb md-thumb-comment" aria-hidden="true">“</span>'}
          <div class="md-target-body">
            <p class="md-kind">${g.targetType === 'video' ? 'Video' : `Comment${g.videoTitle ? ` on “${esc(g.videoTitle)}”` : ''}`}
              ${g.hidden ? '<span class="md-tag md-tag-hidden">Hidden</span>' : ''}
              ${!g.exists ? '<span class="md-tag">No longer exists</span>' : ''}</p>
            ${g.targetType === 'video'
              ? `<p class="md-title">${esc(g.title || 'Untitled')}</p>`
              : `<blockquote class="md-quote">${esc(g.text || '')}</blockquote>`}
            <p class="md-meta">
              by <strong>${esc(g.owner ? g.owner.username : 'unknown')}</strong>${g.owner && g.owner.bannedUntil ? ` <span class="md-tag md-tag-hidden">Restricted ${esc(until(g.owner.bannedUntil))}</span>` : ''}
              ${g.link ? ` · <a href="${esc(g.link)}" target="_blank" rel="noopener">Open</a>` : ''}
            </p>
          </div>
          <div class="md-count-box" title="Reports"><strong>${g.count}</strong><span>${g.count === 1 ? 'report' : 'reports'}</span></div>
        </div>
        <div class="md-chips">${reasonChips(g.reports)}</div>
        <details class="md-details"><summary>Show reports</summary>
          <ul>${g.reports.map((r) => `<li><strong>${esc(r.reporter)}</strong> · ${esc(r.reasonText || r.reason)} · <time>${esc(when(r.createdAt))}</time>${r.note ? `<p>${esc(r.note)}</p>` : ''}</li>`).join('')}</ul>
        </details>
        ${status === 'open' ? `
          <div class="md-actions">
            ${g.exists && !g.hidden ? '<button type="button" class="md-btn md-btn-primary" data-act="hide">Hide</button>' : ''}
            ${g.exists ? '<button type="button" class="md-btn md-btn-danger-ghost" data-act="delete">Delete</button>' : ''}
            <button type="button" class="md-btn md-btn-quiet" data-act="dismiss">${g.exists ? 'Dismiss reports' : 'Close'}</button>
            ${g.owner && g.exists && !g.owner.bannedUntil ? '<button type="button" class="md-btn md-btn-quiet" data-act="ban">Restrict author</button>' : ''}
          </div>` : `
          <p class="md-outcome">${esc(outcome[g.action] || g.action || g.status)} · ${esc(g.resolvedBy ? g.resolvedBy.username : 'system')} · ${esc(when(g.resolvedAt))}
            ${g.exists && g.hidden ? ' <button type="button" class="md-btn md-btn-quiet md-btn-sm" data-act="unhide">Restore</button>' : ''}</p>`}
      </li>`).join('')}</ul>`;

    $$('.md-item', reportsBox).forEach((li) => {
      const g = groups[Number(li.dataset.i)];
      const done = (msg) => { notify(msg); loadReports(); refreshCount(); };
      li.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        const path = `/${g.targetType}/${g.target}`;
        const what = g.targetType === 'video' ? 'video' : 'comment';
        if (act === 'hide') {
          inlineForm(li, { label: `Hide this ${what}? Viewers will not see it; the author sees the reason.`, needReason: true, confirmText: 'Hide' },
            async ({ reason }) => { await api(path + '/hide', { reason }); done(`The ${what} is hidden`); });
        } else if (act === 'delete') {
          inlineForm(li, { label: `Delete this ${what} for good? This cannot be undone.`, needReason: true, confirmText: 'Delete', danger: true },
            async ({ reason }) => { await api(path + '/delete', { reason }); done(`The ${what} is deleted`); });
        } else if (act === 'dismiss') {
          api(path + '/dismiss', {}).then(() => done('Reports dismissed'), (err) => notify('Failed: ' + err.message));
        } else if (act === 'unhide') {
          api(path + '/unhide', {}).then(() => done(`The ${what} is visible again`), (err) => notify('Failed: ' + err.message));
        } else if (act === 'ban') {
          inlineForm(li, { label: `Restrict ${g.owner.username}: no uploads, comments or reports. All their sessions end.`, needReason: true, banDays: true, confirmText: 'Restrict', danger: true },
            async ({ reason, days }) => { await api(`/users/${g.owner.id}/ban`, { reason, days }); done(`${g.owner.username} is restricted`); });
        }
      });
    });
  }

  async function loadReports() {
    reportsBox.setAttribute('aria-busy', 'true');
    try {
      renderReports(await api(`/reports?status=${status}`));
    } catch (err) {
      reportsBox.innerHTML = `<p class="md-empty">Could not load reports: ${esc(err.message)}</p>`;
    } finally {
      reportsBox.removeAttribute('aria-busy');
    }
  }
  loaders.reports = loadReports;

  async function refreshCount() {
    try {
      const { openReports } = await api('/summary');
      const c = $('#mdOpenCount');
      c.textContent = String(openReports);
      c.hidden = !openReports;
      const h = document.getElementById('modCount');
      if (h) { h.textContent = String(openReports); h.hidden = !openReports; }
    } catch { /* ignore */ }
  }

  // ------------------------------------------------------------------ users
  const usersBox = $('#mdUsers');
  const query = $('#mdUserQuery');
  let userTimer = 0;
  query.addEventListener('input', () => { clearTimeout(userTimer); userTimer = setTimeout(loadUsers, 300); });

  function renderUsers(users) {
    if (!users.length) { usersBox.innerHTML = '<p class="md-empty">Nobody found.</p>'; return; }
    usersBox.innerHTML = `<div class="md-table-wrap"><table class="md-table">
      <thead><tr><th>User</th><th>Role</th><th>Joined</th><th class="num">Reports</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${users.map((u, i) => `
        <tr data-i="${i}">
          <td><strong>${esc(u.username)}</strong><span class="md-login">@${esc(u.login)}</span></td>
          <td>${isAdmin && u.canManage
            ? `<select data-role aria-label="Role of ${esc(u.login)}">${['user', 'moderator', 'admin'].map((r) => `<option value="${r}"${r === u.role ? ' selected' : ''}>${r}</option>`).join('')}</select>`
            : `<span class="md-role md-role-${esc(u.role)}">${esc(u.role)}</span>`}</td>
          <td>${esc(u.joined ? new Date(u.joined).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : '')}</td>
          <td class="num">${u.reports}</td>
          <td>${u.bannedUntil ? `<span class="md-tag md-tag-hidden" title="${esc(u.banReason)}">Restricted ${esc(until(u.bannedUntil))}</span>` : '<span class="md-ok">Active</span>'}</td>
          <td class="md-row-actions">${u.canManage
            ? (u.bannedUntil ? '<button type="button" class="md-btn md-btn-quiet md-btn-sm" data-act="unban">Lift restriction</button>'
              : '<button type="button" class="md-btn md-btn-quiet md-btn-sm" data-act="ban">Restrict</button>')
            : ''}</td>
        </tr>
        <tr class="md-form-row" hidden><td colspan="6"></td></tr>`).join('')}</tbody></table></div>`;

    $$('tbody tr[data-i]', usersBox).forEach((tr) => {
      const u = users[Number(tr.dataset.i)];
      const formRow = tr.nextElementSibling;
      tr.querySelector('[data-role]')?.addEventListener('change', async (e) => {
        try {
          await api(`/users/${u.id}/role`, { role: e.target.value });
          notify(`${u.login} is now ${e.target.value}`);
        } catch (err) {
          notify('Failed: ' + err.message);
          e.target.value = u.role;
        }
      });
      tr.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'unban') {
          api(`/users/${u.id}/unban`, {}).then(() => { notify('Restriction lifted'); loadUsers(); }, (err) => notify('Failed: ' + err.message));
        } else if (act === 'ban') {
          formRow.hidden = false;
          const cell = formRow.firstElementChild;
          cell.innerHTML = '';
          inlineForm(cell, { label: `Restrict ${u.username}: no uploads, comments or reports. All their sessions end.`, needReason: true, banDays: true, confirmText: 'Restrict', danger: true },
            async ({ reason, days }) => { await api(`/users/${u.id}/ban`, { reason, days }); notify(`${u.username} is restricted`); loadUsers(); });
          cell.querySelector('[data-cancel]').addEventListener('click', () => (formRow.hidden = true));
        }
      });
    });
  }

  async function loadUsers() {
    try {
      renderUsers(await api(`/users?q=${encodeURIComponent(query.value.trim())}`));
    } catch (err) {
      usersBox.innerHTML = `<p class="md-empty">Could not load users: ${esc(err.message)}</p>`;
    }
  }
  loaders.users = loadUsers;

  // ------------------------------------------------------------------ log
  const logBox = $('#mdLog');
  const actionText = { hide: 'hid', unhide: 'restored', delete: 'deleted', dismiss: 'dismissed reports on', ban: 'restricted', unban: 'lifted the restriction of', role: 'changed the role of' };
  async function loadLog() {
    try {
      const rows = await api('/log');
      logBox.innerHTML = rows.length ? `<ol class="md-log">${rows.map((r) => `
        <li>
          <time>${esc(when(r.createdAt))}</time>
          <p><strong>${esc(r.actor)}</strong> ${esc(actionText[r.action] || r.action)} ${esc(r.targetType)}
            <span class="md-log-label">${esc(r.label)}</span>${r.details ? ` <span class="md-chip">${esc(r.details)}</span>` : ''}</p>
          ${r.reason ? `<p class="md-log-reason">Reason: ${esc(r.reason)}</p>` : ''}
        </li>`).join('')}</ol>` : '<p class="md-empty">No actions yet.</p>';
    } catch (err) {
      logBox.innerHTML = `<p class="md-empty">Could not load the log: ${esc(err.message)}</p>`;
    }
  }
  loaders.log = loadLog;

  refreshCount();
  showTab(location.hash.slice(1) || 'reports');
})();
