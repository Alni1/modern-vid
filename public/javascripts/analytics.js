// Profile page, "Analytics" tab: channel and per-video statistics drawn as plain SVG.
(function () {
  const panel = document.getElementById('panel-analytics');
  if (!panel) return;
  const body = document.getElementById('anBody');
  const crumb = document.getElementById('anCrumb');
  const rangeButtons = [...panel.querySelectorAll('.an-range [data-days]')];
  const SVG = 'http://www.w3.org/2000/svg';

  let days = 28;
  try { days = Number(localStorage.getItem('mv-analytics-days')) || 28; } catch { /* storage unavailable */ }
  if (![7, 28, 90].includes(days)) days = 28;
  let videoId = null; // null: channel overview
  let loaded = false;
  let request = 0;

  // ------------------------------------------------------------------ formatting
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const compact = (n) => {
    if (n < 1000) return String(Math.round(n));
    const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (const [v, u] of units) if (n >= v) return (n / v).toFixed(n / v < 10 ? 1 : 0).replace(/\.0$/, '') + u;
    return String(n);
  };
  const clock = (sec) => {
    sec = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const pad = (x) => String(x).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };
  /** Watch time: minutes below an hour, then hours with one decimal. */
  const watchTime = (sec) => (sec < 3600 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)} h`);
  const hours = (sec) => sec / 3600;
  const dayLabel = (key, opts = { day: 'numeric', month: 'short' }) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
  };
  const pct = (x) => `${Math.round(x * 100)}%`;

  /** Change against the previous period: arrow + signed percent, colored by direction. */
  function delta(cur, prev) {
    if (!prev) return cur ? '<span class="an-delta">new in this period</span>' : '';
    const ch = (cur - prev) / prev;
    if (Math.abs(ch) < 0.005) return '<span class="an-delta">same as previous period</span>';
    const up = ch > 0;
    return `<span class="an-delta ${up ? 'is-up' : 'is-down'}"><span aria-hidden="true">${up ? '▲' : '▼'}</span> ${up ? '+' : '−'}${Math.round(Math.abs(ch) * 100)}% <span class="an-delta-ref">vs previous ${days} days</span></span>`;
  }

  // ------------------------------------------------------------------ chart helpers
  function el(name, attrs = {}, parent) {
    const n = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.append(n);
    return n;
  }
  /** Round axis maximum and 4 tick steps. */
  function niceScale(max) {
    if (!(max > 0)) return { top: 4, step: 1 };
    const raw = max / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    return { top: step * 4, step };
  }
  /** Tooltip shared by the charts; positioned inside the chart box. */
  function tooltip(box) {
    const tip = document.createElement('div');
    tip.className = 'an-tip';
    tip.hidden = true;
    box.append(tip);
    return {
      show(html, x, y) {
        tip.innerHTML = html;
        tip.hidden = false;
        const w = tip.offsetWidth, bw = box.clientWidth;
        tip.style.left = Math.min(Math.max(x - w / 2, 0), bw - w) + 'px';
        tip.style.top = Math.max(y - tip.offsetHeight - 10, 0) + 'px';
      },
      hide() { tip.hidden = true; },
    };
  }
  /** Redraws on width changes. */
  function responsive(box, draw) {
    let w = 0;
    const ro = new ResizeObserver(() => {
      if (box.clientWidth && box.clientWidth !== w) { w = box.clientWidth; draw(w); }
    });
    ro.observe(box);
  }

  /** Daily columns of one measure (views or watch hours). */
  function columnChart(box, series, valueOf, format, label) {
    const tip = tooltip(box);
    responsive(box, (W) => {
      box.querySelector('svg')?.remove();
      const H = 240, padL = 44, padR = 8, padT = 12, padB = 28;
      const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, style: `width:${W}px;height:${H}px`, role: 'img', 'aria-label': `${label} per day` });
      box.prepend(svg);
      const values = series.map(valueOf);
      const { top, step } = niceScale(Math.max(...values));
      const iw = W - padL - padR, ih = H - padT - padB;
      const y = (v) => padT + ih - (v / top) * ih;
      for (let v = 0; v <= top + 1e-9; v += step) {
        el('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'an-grid' }, svg);
        el('text', { x: padL - 8, y: y(v) + 4, class: 'an-axis', 'text-anchor': 'end' }, svg).textContent = format(v, true);
      }
      const band = iw / series.length;
      const bw = Math.max(2, Math.min(24, band - 2)); // 2px surface gap between touching columns
      const labelEvery = Math.ceil(series.length / Math.max(2, Math.floor(iw / 64)));
      series.forEach((d, i) => {
        const v = values[i];
        const x = padL + i * band + (band - bw) / 2;
        const h = (v / top) * ih;
        if (h > 0) {
          const r = Math.min(4, bw / 2, h);
          const yb = padT + ih;
          // Rounded data end, square at the baseline.
          el('path', { class: 'an-bar', d: `M${x},${yb}V${yb - h + r}Q${x},${yb - h} ${x + r},${yb - h}H${x + bw - r}Q${x + bw},${yb - h} ${x + bw},${yb - h + r}V${yb}Z` }, svg);
        }
        if ((series.length - 1 - i) % labelEvery === 0) {
          el('text', { x: padL + i * band + band / 2, y: H - 8, class: 'an-axis', 'text-anchor': 'middle' }, svg).textContent = dayLabel(d.day);
        }
        // Hit target: the whole band, taller than the column.
        const hit = el('rect', { x: padL + i * band, y: padT, width: band, height: ih, class: 'an-hit' }, svg);
        const show = () => {
          hit.classList.add('an-hit-on');
          tip.show(`<b>${format(v)}</b><span>${dayLabel(d.day, { weekday: 'short', day: 'numeric', month: 'short' })}</span>`, padL + i * band + band / 2, y(v));
        };
        hit.addEventListener('pointerenter', show);
        hit.addEventListener('pointerleave', () => { hit.classList.remove('an-hit-on'); tip.hide(); });
      });
      el('line', { x1: padL, x2: W - padR, y1: padT + ih, y2: padT + ih, class: 'an-baseline' }, svg);
    });
  }

  /** Audience retention: share of views that reached each moment of the video. */
  function retentionChart(box, curve, duration) {
    const tip = tooltip(box);
    responsive(box, (W) => {
      box.querySelector('svg')?.remove();
      const H = 260, padL = 44, padR = 12, padT = 12, padB = 28;
      const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, style: `width:${W}px;height:${H}px`, role: 'img', 'aria-label': 'Audience retention' });
      box.prepend(svg);
      const iw = W - padL - padR, ih = H - padT - padB;
      const n = curve.length;
      const x = (i) => padL + ((i + 0.5) / n) * iw; // bucket i is plotted at its middle
      const y = (v) => padT + ih - v * ih;
      for (let v = 0; v <= 1.0001; v += 0.25) {
        el('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'an-grid' }, svg);
        el('text', { x: padL - 8, y: y(v) + 4, class: 'an-axis', 'text-anchor': 'end' }, svg).textContent = pct(v);
      }
      for (let k = 0; k <= 4; k++) {
        el('text', { x: padL + (k / 4) * iw, y: H - 8, class: 'an-axis', 'text-anchor': k === 0 ? 'start' : k === 4 ? 'end' : 'middle' }, svg)
          .textContent = clock((k / 4) * duration);
      }
      const pts = curve.map((v, i) => `${x(i)},${y(v)}`).join(' L');
      el('path', { class: 'an-area', d: `M${x(0)},${padT + ih} L${pts} L${x(n - 1)},${padT + ih} Z` }, svg);
      el('path', { class: 'an-line', d: `M${pts}` }, svg);
      const cross = el('line', { y1: padT, y2: padT + ih, class: 'an-cross', visibility: 'hidden' }, svg);
      const dot = el('circle', { r: 5, class: 'an-dot', visibility: 'hidden' }, svg);
      const hit = el('rect', { x: padL, y: padT, width: iw, height: ih, class: 'an-hit' }, svg);
      const move = (e) => {
        const r = svg.getBoundingClientRect();
        const i = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left - padL) / iw) * n)));
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(curve[i])); dot.setAttribute('visibility', 'visible');
        tip.show(`<b>${pct(curve[i])} of views</b><span>reached ${clock(((i + 0.5) / n) * duration)}</span>`, x(i), y(curve[i]));
      };
      hit.addEventListener('pointermove', move);
      hit.addEventListener('pointerdown', move);
      hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hide(); });
      el('line', { x1: padL, x2: W - padR, y1: padT + ih, y2: padT + ih, class: 'an-baseline' }, svg);
    });
  }

  // ------------------------------------------------------------------ views
  const tile = (label, value, extra = '') => `<div class="an-tile"><span class="an-tile-label">${label}</span><span class="an-tile-value">${value}</span>${extra}</div>`;

  /** Card with a daily chart, a Views / Watch time switch and the data as a table. */
  function dailyCard(daily) {
    const card = document.createElement('section');
    card.className = 'an-card';
    card.innerHTML = `
      <div class="an-card-head">
        <h3>Per day</h3>
        <div class="an-switch" role="radiogroup" aria-label="Measure">
          <button type="button" role="radio" aria-checked="true" data-m="views">Views</button>
          <button type="button" role="radio" aria-checked="false" data-m="watch">Watch time</button>
        </div>
      </div>
      <div class="an-chart"></div>
      <details class="an-data"><summary>Show data</summary>
        <table><thead><tr><th>Day</th><th>Views</th><th>Watch time</th></tr></thead><tbody>
          ${daily.slice().reverse().map((d) => `<tr><td>${dayLabel(d.day, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td>${d.views}</td><td>${watchTime(d.watched)}</td></tr>`).join('')}
        </tbody></table>
      </details>`;
    const draw = (m) => {
      const old = card.querySelector('.an-chart');
      const box = document.createElement('div');
      box.className = 'an-chart';
      old.replaceWith(box);
      if (m === 'views') columnChart(box, daily, (d) => d.views, (v) => compact(v), 'Views');
      else if (Math.max(...daily.map((d) => d.watched)) < 3600) {
        columnChart(box, daily, (d) => d.watched / 60, (v, axis) => (axis ? `${+v.toFixed(1)} min` : watchTime(v * 60)), 'Watch time');
      } else {
        columnChart(box, daily, (d) => hours(d.watched), (v, axis) => (axis ? `${+v.toFixed(1)} h` : watchTime(v * 3600)), 'Watch time');
      }
    };
    card.querySelectorAll('.an-switch button').forEach((b) => b.addEventListener('click', () => {
      card.querySelectorAll('.an-switch button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      draw(b.dataset.m);
    }));
    queueMicrotask(() => draw('views'));
    return card;
  }

  function renderChannel(data) {
    crumb.innerHTML = '<h2>Channel analytics</h2>';
    const t = data.totals, p = data.previous;
    const avgDur = t.views ? t.viewWatched / t.views : 0;
    const prevAvg = p.views ? p.viewWatched / p.views : 0;
    body.innerHTML = `
      <div class="an-tiles">
        ${tile('Views', compact(t.views), delta(t.views, p.views))}
        ${tile('Watch time', watchTime(t.watched), delta(t.watched, p.watched))}
        ${tile('Average view duration', clock(avgDur), delta(avgDur, prevAvg))}
      </div>`;
    body.append(dailyCard(data.daily));
    const list = document.createElement('section');
    list.className = 'an-card';
    list.innerHTML = data.videos.length ? `
      <div class="an-card-head"><h3>Videos</h3><span class="pf-muted">Last ${days} days · select a video for details</span></div>
      <div class="an-table-wrap"><table class="an-table">
        <thead><tr><th>Video</th><th class="num">Views</th><th class="num">Watch time</th><th>Average viewed</th></tr></thead>
        <tbody>${data.videos.map((v) => `
          <tr>
            <td><button type="button" class="an-video" data-id="${esc(v.id)}">
              ${v.thumbnailUrl ? `<img src="${esc(v.thumbnailUrl)}" alt="" loading="lazy">` : '<span class="an-thumb-empty"></span>'}
              <span class="an-video-title">${esc(v.title || 'Untitled')}</span></button></td>
            <td class="num">${compact(v.views)}</td>
            <td class="num">${watchTime(v.watched)}</td>
            <td>${v.avgPercent == null ? '<span class="pf-muted">—</span>' : `<span class="an-meter"><span style="width:${Math.min(100, v.avgPercent)}%"></span></span> ${Math.round(v.avgPercent)}%`}</td>
          </tr>`).join('')}</tbody>
      </table></div>` : '<p class="pf-muted">Upload a video to see its statistics here.</p>';
    list.querySelectorAll('.an-video').forEach((b) => b.addEventListener('click', () => { videoId = b.dataset.id; load(); }));
    body.append(list);
    if (!t.views && !p.views && !t.watched) {
      const note = document.createElement('p');
      note.className = 'an-empty';
      note.textContent = `No views in the last ${days} days yet. Statistics appear when someone watches your videos for at least a few seconds.`;
      body.prepend(note);
    }
  }

  function renderVideo(data) {
    crumb.innerHTML = `<button type="button" class="an-back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>All videos</button><h2>${esc(data.video.title || 'Untitled')}</h2>`;
    crumb.querySelector('.an-back').addEventListener('click', () => { videoId = null; load(); });
    const t = data.totals, p = data.previous;
    body.innerHTML = `
      <div class="an-tiles">
        ${tile('Views', compact(t.views), delta(t.views, p.views))}
        ${tile('Watch time', watchTime(t.watched), delta(t.watched, p.watched))}
        ${tile('Average view duration', clock(data.avgViewDuration), `<span class="an-delta">of ${clock(data.video.duration)}</span>`)}
        ${tile('Average viewed', data.avgPercent == null ? '—' : `${Math.round(data.avgPercent)}%`)}
      </div>`;
    body.append(dailyCard(data.daily));
    const card = document.createElement('section');
    card.className = 'an-card';
    const marks = [0, 10, 25, 50, 75, 90, 99];
    card.innerHTML = `
      <div class="an-card-head"><h3>Audience retention</h3><span class="pf-muted">Share of views that reached each moment</span></div>
      ${t.views ? '<div class="an-chart"></div>' : '<p class="pf-muted">No views in this period yet.</p>'}
      ${t.views ? `<details class="an-data"><summary>Show data</summary><table><thead><tr><th>Moment</th><th>Views that reached it</th></tr></thead><tbody>
        ${marks.map((i) => `<tr><td>${clock((i / 100) * data.video.duration)} (${i}%)</td><td>${pct(data.retention[i])}</td></tr>`).join('')}
      </tbody></table></details>` : ''}`;
    body.append(card);
    if (t.views) retentionChart(card.querySelector('.an-chart'), data.retention, data.video.duration);
  }

  // ------------------------------------------------------------------ loading
  async function load() {
    loaded = true;
    const id = ++request;
    body.setAttribute('aria-busy', 'true');
    try {
      const url = videoId ? `/api/analytics/video/${encodeURIComponent(videoId)}?days=${days}` : `/api/analytics/channel?days=${days}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
      const data = await res.json();
      if (id !== request) return; // a newer request replaced this one
      (videoId ? renderVideo : renderChannel)(data);
    } catch (err) {
      if (id !== request) return;
      body.innerHTML = `<p class="an-empty">Could not load the statistics: ${esc(err.message)}. <button type="button" class="pf-btn pf-btn-ghost an-retry">Try again</button></p>`;
      body.querySelector('.an-retry').addEventListener('click', load);
    } finally {
      if (id === request) body.removeAttribute('aria-busy');
    }
  }

  rangeButtons.forEach((b) => {
    b.setAttribute('aria-checked', String(Number(b.dataset.days) === days));
    b.addEventListener('click', () => {
      days = Number(b.dataset.days);
      try { localStorage.setItem('mv-analytics-days', String(days)); } catch { /* ignore */ }
      rangeButtons.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      load();
    });
  });

  // Data is loaded the first time the tab is opened.
  const start = () => { if (!panel.hidden && !loaded) load(); };
  new MutationObserver(start).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  start();
})();
