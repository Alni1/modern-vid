import type { PlayerCore, PlaybackState } from '../core/PlayerCore';
import type { ControlId, PlayerConfig } from '../config/types';
import { icons } from './icons';
import { formatRate, formatTime } from './format';

export interface ControlContext {
  core: PlayerCore;
  config: PlayerConfig;
  /** Player-level UI actions available to controls. */
  ui?: {
    toggleSettings(): void;
    settingsOpen(): boolean;
    toggleTheater?(): void;
    theaterOn?(): boolean;
    /** Subtitle tracks of the video and the selected language. */
    captions?: { tracks(): Array<{ lang: string; label: string }>; current(): string | null; select(lang: string | null): void };
    /** A-B repeat: the points set so far and the next step (set A, set B, clear). */
    loop?: { state(): { a: number | null; b: number | null }; cycle(): void };
    /** Title of the chapter at the given time (null without chapters). */
    chapterAt?(time: number): string | null;
  };
}

export interface Control {
  el: HTMLElement;
  update(state: PlaybackState): void;
  destroy?(): void;
}

type ControlFactory = (ctx: ControlContext) => Control;

function button(cls: string, label: string, html: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `mv-btn ${cls}`;
  b.setAttribute('aria-label', label);
  b.title = label;
  b.innerHTML = html;
  return b;
}

function setIcon(b: HTMLButtonElement, html: string, label: string): void {
  if (b.dataset.icon !== html) {
    b.innerHTML = html;
    b.dataset.icon = html;
  }
  if (b.getAttribute('aria-label') !== label) {
    b.setAttribute('aria-label', label);
    b.title = label;
  }
}

const play: ControlFactory = ({ core }) => {
  const el = button('mv-play', 'Play', icons.play);
  el.addEventListener('click', () => core.togglePlay());
  return {
    el,
    update: (s) => {
      if (s.ended) setIcon(el, icons.replay, 'Replay');
      else if (s.paused) setIcon(el, icons.play, 'Play');
      else setIcon(el, icons.pause, 'Pause');
    },
  };
};

const rewind: ControlFactory = ({ core, config }) => {
  const el = button('mv-rewind', `Back ${config.behavior.seekStep} s`, icons.rewind);
  el.addEventListener('click', () => core.seekBy(-config.behavior.seekStep));
  return { el, update: () => undefined };
};

const forward: ControlFactory = ({ core, config }) => {
  const el = button('mv-forward', `Forward ${config.behavior.seekStep} s`, icons.forward);
  el.addEventListener('click', () => core.seekBy(config.behavior.seekStep));
  return { el, update: () => undefined };
};

const volume: ControlFactory = ({ core }) => {
  const el = document.createElement('div');
  el.className = 'mv-volume';
  const mute = button('mv-mute', 'Mute', icons.volume);
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.05';
  slider.className = 'mv-volume-slider';
  slider.setAttribute('aria-label', 'Volume');
  mute.addEventListener('click', () => {
    const muted = !core.video.muted;
    if (!muted && core.video.volume === 0) core.setVolume(0.5);
    core.setMuted(muted);
  });
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    core.setVolume(v);
    core.setMuted(v === 0);
  });
  el.append(mute, slider);
  return {
    el,
    update: (s) => {
      const level = s.muted ? 0 : s.volume;
      if (document.activeElement !== slider) slider.value = String(level);
      el.style.setProperty('--mv-volume', `${level * 100}%`);
      if (level === 0) setIcon(mute, icons.muted, 'Unmute');
      else setIcon(mute, level < 0.5 ? icons.volumeLow : icons.volume, 'Mute');
    },
  };
};

const time: ControlFactory = ({ ui }) => {
  const el = document.createElement('div');
  el.className = 'mv-time';
  el.setAttribute('aria-live', 'off');
  return {
    el,
    update: (s) => {
      const chapter = ui?.chapterAt?.(s.currentTime);
      const text = `${formatTime(s.currentTime)} / ${formatTime(s.duration)}${chapter ? ` · ${chapter}` : ''}`;
      if (el.textContent !== text) el.textContent = text;
    },
  };
};

const spacer: ControlFactory = () => {
  const el = document.createElement('div');
  el.className = 'mv-spacer';
  return { el, update: () => undefined };
};

interface MenuItem {
  label: string;
  checked: boolean;
  onSelect(): void;
}

/** Button with a pop-up menu (used by the speed and quality controls). */
function createMenu(cls: string, label: string): {
  el: HTMLDivElement;
  btn: HTMLButtonElement;
  setItems(items: MenuItem[]): void;
  destroy(): void;
} {
  const el = document.createElement('div');
  el.className = 'mv-menu-wrap';
  const btn = button(`${cls} mv-text-btn`, label, '');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div');
  menu.className = 'mv-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', label);
  menu.hidden = true;
  const close = (): void => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  const onDocClick = (e: Event): void => {
    if (!e.composedPath().includes(el)) close();
  };
  btn.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) (menu.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll<HTMLElement>('.mv-menu-item')];
    const i = items.indexOf(e.composedPath()[0] as HTMLElement);
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      btn.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  });
  document.addEventListener('click', onDocClick, true);
  el.append(btn, menu);
  let signature = '';
  return {
    el,
    btn,
    setItems(items) {
      const sig = items.map((it) => `${it.label}:${it.checked}`).join('|');
      if (sig === signature) return;
      signature = sig;
      menu.replaceChildren(
        ...items.map((it) => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'mv-menu-item';
          item.setAttribute('role', 'menuitemradio');
          item.setAttribute('aria-checked', String(it.checked));
          item.textContent = it.label;
          item.addEventListener('click', () => {
            it.onSelect();
            close();
            btn.focus();
          });
          return item;
        }),
      );
    },
    destroy: () => document.removeEventListener('click', onDocClick, true),
  };
}

const speed: ControlFactory = ({ core, config }) => {
  const m = createMenu('mv-speed', 'Playback speed');
  return {
    el: m.el,
    update: (s) => {
      const t = formatRate(s.rate);
      if (m.btn.textContent !== t) m.btn.textContent = t;
      m.setItems(
        [...config.behavior.speeds].reverse().map((rate) => ({
          label: rate === 1 ? 'Normal' : formatRate(rate),
          checked: Math.abs(rate - s.rate) < 1e-3,
          onSelect: () => core.setRate(rate),
        })),
      );
    },
    destroy: m.destroy,
  };
};

/** Quality menu: "Auto" (ABR) or a fixed level. Hidden when there is only one quality. */
const quality: ControlFactory = ({ core }) => {
  const m = createMenu('mv-quality', 'Quality');
  const render = (): void => {
    const levels = core.levels;
    m.el.hidden = levels.length < 2;
    if (levels.length < 2) return;
    const current = levels[core.currentLevel];
    const auto = core.autoQuality;
    const text = auto ? `Auto${current ? ` · ${current.name}` : ''}` : current?.name ?? '';
    if (m.btn.textContent !== text) m.btn.textContent = text;
    m.setItems([
      ...[...levels].reverse().map((l) => ({
        label: l.name,
        checked: !auto && core.currentLevel === l.index,
        onSelect: () => core.setLevel(l.index),
      })),
      { label: `Auto${auto && current ? ` (${current.name})` : ''}`, checked: auto, onSelect: () => core.setLevel(-1) },
    ]);
  };
  const offs = [core.bus.on('levels', render), core.bus.on('levelSwitch', render), core.bus.on('qualityMode', render)];
  render();
  return { el: m.el, update: () => undefined, destroy: () => { offs.forEach((off) => off()); m.destroy(); } };
};

const pip: ControlFactory = ({ core }) => {
  const el = button('mv-pip', 'Picture in picture', icons.pip);
  if (!document.pictureInPictureEnabled) el.hidden = true;
  el.addEventListener('click', () => void core.togglePip());
  return { el, update: (s) => el.classList.toggle('mv-active', s.pip) };
};

const fullscreen: ControlFactory = ({ core }) => {
  const el = button('mv-fullscreen', 'Full screen', icons.fullscreen);
  if (!document.fullscreenEnabled) el.hidden = true;
  el.addEventListener('click', () => void core.toggleFullscreen());
  return {
    el,
    update: (s) =>
      s.fullscreen
        ? setIcon(el, icons.exitFullscreen, 'Exit full screen')
        : setIcon(el, icons.fullscreen, 'Full screen'),
  };
};

/** Subtitles: CC button with a menu of the video's tracks. Hidden when the video has none. */
const captions: ControlFactory = ({ ui }) => {
  const m = createMenu('mv-captions', 'Subtitles');
  m.btn.innerHTML = icons.captions;
  m.btn.classList.remove('mv-text-btn');
  return {
    el: m.el,
    update: () => {
      const cc = ui?.captions;
      const tracks = cc?.tracks() ?? [];
      // Without subtitle tracks the button stays (the viewer may have placed it) but is dimmed.
      m.btn.classList.toggle('mv-dim', tracks.length === 0);
      m.btn.title = tracks.length ? 'Subtitles' : 'This video has no subtitles';
      if (!cc || !tracks.length) {
        m.btn.classList.remove('mv-active');
        m.setItems([{ label: 'No subtitles for this video', checked: false, onSelect: () => undefined }]);
        return;
      }
      const current = cc.current();
      m.btn.classList.toggle('mv-active', current !== null);
      m.setItems([
        { label: 'Off', checked: current === null, onSelect: () => cc.select(null) },
        ...tracks.map((t) => ({ label: t.label, checked: current === t.lang, onSelect: () => cc.select(t.lang) })),
      ]);
    },
    destroy: m.destroy,
  };
};

/** A-B repeat: first press sets A, second sets B (the fragment then repeats), third clears. */
const loop: ControlFactory = ({ ui }) => {
  const el = button('mv-loop', 'Repeat from A', icons.loop);
  const badge = document.createElement('span');
  badge.className = 'mv-loop-badge';
  el.append(badge);
  el.addEventListener('click', () => ui?.loop?.cycle());
  return {
    el,
    update: () => {
      const st = ui?.loop?.state() ?? { a: null, b: null };
      const step = st.a === null ? '' : st.b === null ? 'A' : 'A-B';
      if (badge.textContent !== step) badge.textContent = step;
      el.classList.toggle('mv-active', st.a !== null);
      const label = st.a === null ? 'Repeat from A' : st.b === null ? 'Set point B' : 'Stop repeating';
      if (el.getAttribute('aria-label') !== label) {
        el.setAttribute('aria-label', label);
        el.title = label;
      }
    },
  };
};

/** Theater mode: the page widens the player (the page listens to the mv-theater event). */
const theater: ControlFactory = ({ ui }) => {
  const el = button('mv-theater', 'Theater mode', icons.theater);
  el.addEventListener('click', () => ui?.toggleTheater?.());
  return {
    el,
    update: () => {
      const on = ui?.theaterOn?.() ?? false;
      setIcon(el, on ? icons.theaterExit : icons.theater, on ? 'Default view' : 'Theater mode');
      el.classList.toggle('mv-active', on);
    },
  };
};

const settings: ControlFactory = ({ ui }) => {
  const el = button('mv-settings-btn', 'Player settings', icons.settings);
  el.setAttribute('aria-haspopup', 'dialog');
  el.addEventListener('click', () => ui?.toggleSettings());
  return {
    el,
    update: () => {
      const open = ui?.settingsOpen() ?? false;
      el.classList.toggle('mv-active', open);
      el.setAttribute('aria-expanded', String(open));
    },
  };
};

/** Registry of all controls available to the layout. Plugins can add more. */
export const controlRegistry = new Map<ControlId | string, ControlFactory>([
  ['play', play],
  ['rewind', rewind],
  ['forward', forward],
  ['volume', volume],
  ['time', time],
  ['spacer', spacer],
  ['speed', speed],
  ['quality', quality],
  ['settings', settings],
  ['pip', pip],
  ['theater', theater],
  ['captions', captions],
  ['loop', loop],
  ['fullscreen', fullscreen],
]);

export function registerControl(id: string, factory: ControlFactory): void {
  controlRegistry.set(id, factory);
}
