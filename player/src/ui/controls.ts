import type { PlayerCore, PlaybackState } from '../core/PlayerCore';
import type { ControlId, PlayerConfig } from '../config/types';
import { icons } from './icons';
import { formatRate, formatTime } from './format';

export interface ControlContext {
  core: PlayerCore;
  config: PlayerConfig;
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

const speed: ControlFactory = ({ core, config }) => {
  const el = document.createElement('div');
  el.className = 'mv-menu-wrap';
  const btn = button('mv-speed mv-text-btn', 'Playback speed', '1×');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div');
  menu.className = 'mv-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const items = config.behavior.speeds.map((rate) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'mv-menu-item';
    item.setAttribute('role', 'menuitemradio');
    item.textContent = rate === 1 ? 'Normal' : formatRate(rate);
    item.addEventListener('click', () => {
      core.setRate(rate);
      close();
      btn.focus();
    });
    menu.append(item);
    return { rate, item };
  });
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
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      btn.focus();
    }
  });
  document.addEventListener('click', onDocClick, true);
  el.append(btn, menu);
  return {
    el,
    update: (s) => {
      const t = formatRate(s.rate);
      if (btn.textContent !== t) btn.textContent = t;
      items.forEach(({ rate, item }) => item.setAttribute('aria-checked', String(Math.abs(rate - s.rate) < 1e-3)));
    },
    destroy: () => document.removeEventListener('click', onDocClick, true),
  };
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

/** Registry of all controls available to the layout. Plugins can add more. */
export const controlRegistry = new Map<ControlId | string, ControlFactory>([
  ['play', play],
  ['rewind', rewind],
  ['forward', forward],
  ['volume', volume],
  ['time', time],
  ['spacer', spacer],
  ['speed', speed],
  ['pip', pip],
  ['fullscreen', fullscreen],
]);

export function registerControl(id: string, factory: ControlFactory): void {
  controlRegistry.set(id, factory);
}
