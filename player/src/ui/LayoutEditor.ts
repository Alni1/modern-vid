import type { ControlId } from '../config/types';
import { CONTROL_NAMES } from '../config/defaults';
import { icons } from './icons';

type Zone = 'left' | 'right' | 'hidden';

export interface LayoutValue {
  left: ControlId[];
  right: ControlId[];
}

/** Small glyph shown on a chip: the control's own icon or a short text. */
const GLYPHS: Partial<Record<ControlId, string>> = {
  play: icons.play,
  rewind: icons.rewind,
  forward: icons.forward,
  volume: icons.volume,
  settings: icons.settings,
  pip: icons.pip,
  fullscreen: icons.fullscreen,
};
const TEXT_GLYPHS: Partial<Record<ControlId, string>> = { time: '0:00', spacer: '↔', speed: '1×', quality: 'HD' };

/** Controls that must always stay on the bar (otherwise the settings could not be reopened). */
const REQUIRED: ControlId[] = ['settings'];

const ZONES: Array<[Zone, string]> = [
  ['left', 'Left side'],
  ['right', 'Right side'],
  ['hidden', 'Hidden'],
];

/**
 * Drag-and-drop editor of the control bar layout. Buttons are chips that can be dragged
 * between the left side, the right side and the "hidden" pool (pointer events, so it works
 * with a mouse, a pen and touch). With the keyboard, ←/→ move the focused chip inside its
 * zone and ↑/↓ move it to the previous / next zone.
 *
 * `onChange` receives the new layout and the id of the moved control (to restore focus).
 */
export function createLayoutEditor(value: LayoutValue, onChange: (next: LayoutValue, moved: ControlId) => void): HTMLElement {
  const used = new Set<ControlId>([...value.left, ...value.right]);
  const lists: Record<Zone, ControlId[]> = {
    left: [...value.left],
    right: [...value.right],
    hidden: (Object.keys(CONTROL_NAMES) as ControlId[]).filter((id) => !used.has(id)),
  };

  const root = document.createElement('div');
  root.className = 'mv-le';
  const zoneEls = new Map<Zone, HTMLElement>();

  const commit = (id: ControlId, zone: Zone, index: number): void => {
    if (zone === 'hidden' && REQUIRED.includes(id)) return;
    const next: Record<Zone, ControlId[]> = { left: [...lists.left], right: [...lists.right], hidden: [...lists.hidden] };
    const from = (Object.keys(next) as Zone[]).find((z) => next[z].includes(id)) as Zone;
    const oldIndex = next[from].indexOf(id);
    next[from].splice(oldIndex, 1);
    // Inside the same zone the removal shifts later positions by one.
    const at = from === zone && index > oldIndex ? index - 1 : index;
    next[zone].splice(Math.max(0, Math.min(at, next[zone].length)), 0, id);
    if (next.left.join() === lists.left.join() && next.right.join() === lists.right.join()) return;
    onChange({ left: next.left, right: next.right }, id);
  };

  ZONES.forEach(([zone, title]) => {
    const box = document.createElement('div');
    box.className = `mv-le-zone mv-le-${zone}`;
    const label = document.createElement('div');
    label.className = 'mv-s-sub';
    label.textContent = title;
    const area = document.createElement('div');
    area.className = 'mv-le-area';
    area.dataset.zone = zone;
    area.setAttribute('role', 'list');
    area.setAttribute('aria-label', title);
    lists[zone].forEach((id) => area.append(chip(id, zone)));
    if (!lists[zone].length) {
      const empty = document.createElement('span');
      empty.className = 'mv-le-empty';
      empty.textContent = zone === 'hidden' ? 'Drop a button here to hide it' : 'Drop buttons here';
      area.append(empty);
    }
    box.append(label, area);
    root.append(box);
    zoneEls.set(zone, area);
  });

  function chip(id: ControlId, zone: Zone): HTMLButtonElement {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'mv-le-chip';
    c.dataset.id = id;
    c.setAttribute('role', 'listitem');
    const name = CONTROL_NAMES[id] ?? id;
    c.setAttribute('aria-label', `${name}, ${zone === 'hidden' ? 'hidden' : `${zone} side`}`);
    c.title = REQUIRED.includes(id) ? `${name} (always shown)` : name;
    const glyph = document.createElement('span');
    glyph.className = 'mv-le-glyph';
    if (GLYPHS[id]) glyph.innerHTML = GLYPHS[id] as string;
    else glyph.textContent = TEXT_GLYPHS[id] ?? '•';
    const text = document.createElement('span');
    text.textContent = name;
    c.append(glyph, text);
    c.addEventListener('pointerdown', (e) => startDrag(e, c, id));
    c.addEventListener('keydown', (e) => onKey(e, id, zone));
    return c;
  }

  // ---------------------------------------------------------------- keyboard

  function onKey(e: KeyboardEvent, id: ControlId, zone: Zone): void {
    const order: Zone[] = ['left', 'right', 'hidden'];
    const index = lists[zone].indexOf(id);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const to = index + (e.key === 'ArrowLeft' ? -1 : 2); // +2: insertion index after the next chip
      if (to < 0 || to > lists[zone].length) return;
      e.preventDefault();
      commit(id, zone, to);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const z = order[order.indexOf(zone) + (e.key === 'ArrowUp' ? -1 : 1)];
      if (!z) return;
      e.preventDefault();
      commit(id, z, lists[z].length);
    }
  }

  // ---------------------------------------------------------------- pointer drag

  function startDrag(e: PointerEvent, source: HTMLButtonElement, id: ControlId): void {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let ghost: HTMLElement | null = null;
    const placeholder = document.createElement('span');
    placeholder.className = 'mv-le-placeholder';
    let target: { zone: Zone; index: number } | null = null;

    const move = (ev: PointerEvent): void => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        ghost = source.cloneNode(true) as HTMLElement;
        ghost.classList.add('mv-le-ghost');
        const r = source.getBoundingClientRect();
        ghost.style.width = `${r.width}px`;
        root.append(ghost);
        source.classList.add('mv-le-dragging');
        root.classList.add('mv-le-active');
      }
      ev.preventDefault();
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
      target = locate(ev.clientX, ev.clientY, source);
      zoneEls.forEach((area, z) => area.classList.toggle('mv-le-over', target?.zone === z));
      if (target && !(target.zone === 'hidden' && REQUIRED.includes(id))) {
        const area = zoneEls.get(target.zone) as HTMLElement;
        const chips = [...area.querySelectorAll<HTMLElement>('.mv-le-chip:not(.mv-le-dragging)')];
        area.insertBefore(placeholder, chips[target.index] ?? null);
      } else {
        placeholder.remove();
      }
    };

    const end = (): void => {
      source.removeEventListener('pointermove', move);
      source.removeEventListener('pointerup', end);
      source.removeEventListener('pointercancel', cancel);
      const wasDragging = Boolean(ghost);
      ghost?.remove();
      placeholder.remove();
      source.classList.remove('mv-le-dragging');
      root.classList.remove('mv-le-active');
      zoneEls.forEach((area) => area.classList.remove('mv-le-over'));
      if (wasDragging && target) {
        // Index among the chips without the dragged one -> index in the full list.
        const list = lists[target.zone].filter((x) => x !== id);
        const before = list[target.index];
        const full = lists[target.zone];
        const at = before ? full.indexOf(before) : full.length;
        commit(id, target.zone, at);
      }
    };
    const cancel = (): void => {
      target = null;
      end();
    };

    source.setPointerCapture(e.pointerId);
    source.addEventListener('pointermove', move);
    source.addEventListener('pointerup', end);
    source.addEventListener('pointercancel', cancel);
  }

  /** Zone under the pointer and the insertion index among its chips (the dragged chip excluded). */
  function locate(x: number, y: number, dragged: HTMLElement): { zone: Zone; index: number } | null {
    for (const [zone, area] of zoneEls) {
      const r = area.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top - 6 || y > r.bottom + 6) continue;
      const chips = [...area.querySelectorAll<HTMLElement>('.mv-le-chip')].filter((c) => c !== dragged);
      let index = chips.length;
      for (let i = 0; i < chips.length; i++) {
        const c = chips[i].getBoundingClientRect();
        if (y < c.top || (y <= c.bottom && x < c.left + c.width / 2)) {
          index = i;
          break;
        }
      }
      return { zone, index };
    }
    return null;
  }

  return root;
}
