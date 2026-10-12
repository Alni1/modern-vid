import type { PlayerCore, PlaybackState } from '../core/PlayerCore';
import type { ControlId, PlayerConfig } from '../config/types';
import { icons } from './icons';
import { formatRate, formatTime } from './format';

export interface ControlContext {
  core: PlayerCore;
  config: PlayerConfig;
  /** Player-level UI actions available to controls. */
  ui?: { toggleSettings(): void; settingsOpen(): boolean };
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

const time: ControlFactory = () => {
  const el = document.createElement('div');
  el.className = 'mv-time';
  el.setAttribute('aria-live', 'off');
  return {
    el,
    update: (s) => {
      const text = `${formatTime(s.currentTime)} / ${formatTime(s.duration)}`;
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
  ['fullscreen', fullscreen],
]);

export function registerControl(id: string, factory: ControlFactory): void {
  controlRegistry.set(id, factory);
}
