import type { HotkeyAction, PlayerConfig, ViewerPreset } from '../config/types';
import { FONT_STACKS, HOTKEY_NAMES } from '../config/defaults';
import { findConflicts } from '../hotkeys';
import { createLayoutEditor } from './LayoutEditor';

/** What the settings panel needs from the player element. */
export interface SettingsHost {
  /** Effective configuration (after merging all preset levels). */
  config(): PlayerConfig;
  /** The viewer's own overrides. */
  preset(): ViewerPreset;
  /** Whether the channel author defined a theme for this video. */
  hasAuthorTheme(): boolean;
  /** Sets a value in the viewer preset (undefined removes it, i.e. restores the default). */
  set(path: string[], value: unknown): void;
  /** Replaces the whole viewer preset (import / reset). */
  replacePreset(preset: ViewerPreset): void;
  /** Called when the panel opens or closes. */
  onToggle(open: boolean): void;
}

type TabId = 'appearance' | 'controls' | 'playback' | 'quality' | 'hotkeys' | 'preset';

const TABS: Array<[TabId, string]> = [
  ['appearance', 'Look'],
  ['controls', 'Controls'],
  ['playback', 'Playback'],
  ['quality', 'Quality'],
  ['hotkeys', 'Keys'],
  ['preset', 'Preset'],
];

/** Settings group reset by "Reset section" on each tab. */
const TAB_GROUP: Partial<Record<TabId, string>> = {
  appearance: 'theme',
  controls: 'layout',
  quality: 'quality',
  hotkeys: 'hotkeys',
};

const SWATCHES = ['#ff3d3d', '#ff8a00', '#f5c400', '#22c55e', '#00b3ff', '#3d6bff', '#a855f7', '#ec4899', '#ffffff'];

const MODES: Array<[PlayerConfig['quality']['mode'], string, string]> = [
  ['balanced', 'Balanced', 'Good picture without stalls'],
  ['quality', 'Best quality', 'Higher quality sooner, more switches'],
  ['stable', 'Stable', 'Fewest quality changes'],
  ['eco', 'Data saver', 'Up to 480p, less traffic'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function btn(text: string, cls = 'mv-s-btn', label = ''): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  if (label) {
    b.setAttribute('aria-label', label);
    b.title = label;
  }
  return b;
}

/** Human-readable key name. */
export function keyName(key: string): string {
  const names: Record<string, string> = {
    ' ': 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc',
  };
  return names[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

let uid = 0;

/**
 * Settings panel of the player: appearance, control bar layout constructor, playback,
 * adaptive quality, hotkeys and preset import/export. Every change is written into the
 * viewer preset through the host and applied immediately.
 */
export class SettingsPanel {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private tabButtons = new Map<TabId, HTMLButtonElement>();
  private tab: TabId = 'appearance';
  private listening: HotkeyAction | null = null;
  private id = ++uid;

  constructor(private host: SettingsHost) {
    this.el = el('div', 'mv-settings');
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Player settings');

    const head = el('div', 'mv-s-head');
    const tabs = el('div', 'mv-s-tabs');
    tabs.setAttribute('role', 'tablist');
    TABS.forEach(([id, label]) => {
      const b = btn(label, 'mv-s-tab');
      b.setAttribute('role', 'tab');
      b.id = `mv-s-tab-${this.id}-${id}`;
      b.addEventListener('click', () => this.show(id));
      this.tabButtons.set(id, b);
      tabs.append(b);
    });
    const close = btn('', 'mv-s-close', 'Close settings');
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="s" d="M6 6l12 12M18 6L6 18"/></svg>';
    close.addEventListener('click', () => this.close());
    const top = el('div', 'mv-s-top');
    top.append(el('span', 'mv-s-title', 'Player settings'), close);
    head.append(top, tabs);

    this.body = el('div', 'mv-s-body');
    this.body.setAttribute('role', 'tabpanel');
    this.el.append(head, this.body);
    this.el.addEventListener('keydown', this.onKeyDown);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    this.el.hidden = false;
    this.render();
    this.host.onToggle(true);
    this.tabButtons.get(this.tab)?.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.listening = null;
    this.el.hidden = true;
    this.host.onToggle(false);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  show(tab: TabId): void {
    this.tab = tab;
    this.listening = null;
    this.render();
  }

  /** Re-renders the current tab (after structural changes, import or reset). */
  render(): void {
    if (!this.isOpen) return;
    this.tabButtons.forEach((b, id) => {
      b.setAttribute('aria-selected', String(id === this.tab));
      b.tabIndex = id === this.tab ? 0 : -1;
    });
    this.body.setAttribute('aria-labelledby', `mv-s-tab-${this.id}-${this.tab}`);
    const scroll = this.body.scrollTop;
    this.body.replaceChildren(...this.renderTab());
    const group = TAB_GROUP[this.tab];
    if (group) {
      const reset = btn('Reset section', 'mv-s-btn mv-s-reset');
      reset.addEventListener('click', () => {
        this.host.set([group], undefined);
        this.render();
      });
      this.body.append(reset);
    }
    this.body.scrollTop = scroll;
  }

  // ------------------------------------------------------------------ tabs

  private renderTab(): HTMLElement[] {
    switch (this.tab) {
      case 'appearance': return this.appearanceTab();
      case 'controls': return this.controlsTab();
      case 'playback': return this.playbackTab();
      case 'quality': return this.qualityTab();
      case 'hotkeys': return this.hotkeysTab();
      default: return this.presetTab();
    }
  }

  private appearanceTab(): HTMLElement[] {
    const t = this.host.config().theme;
    const out: HTMLElement[] = [];
    if (this.host.hasAuthorTheme()) {
      out.push(this.switchRow('Use the channel\'s theme', ['behavior', 'useAuthorTheme'], this.host.config().behavior.useAuthorTheme));
    }
    out.push(
      this.color('Accent', ['theme', 'accent'], t.accent, SWATCHES),
      this.color('Panel', ['theme', 'background'], t.background, ['#000000', '#1b1f2a', '#0b2540', '#2b1035', '#ffffff']),
      this.color('Text and icons', ['theme', 'foreground'], t.foreground, ['#ffffff', '#e8e8e8', '#ffd84d', '#000000']),
      this.range('Panel opacity', ['theme', 'panelOpacity'], t.panelOpacity, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
      this.range('Corner radius', ['theme', 'radius'], t.radius, 0, 16, 1, (v) => `${v}px`),
      this.select('Button size', ['theme', 'controlSize'], t.controlSize, [['compact', 'Compact'], ['normal', 'Normal'], ['large', 'Large']]),
      this.select('Font', ['theme', 'fontFamily'], t.fontFamily,
        Object.entries(FONT_STACKS).map(([name, stack]) => [stack, name] as [string, string]), true),
    );
    return out;
  }

  private controlsTab(): HTMLElement[] {
    const layout = this.host.config().layout;
    const out: HTMLElement[] = [
      el('p', 'mv-s-hint', 'Drag the buttons to arrange the control bar. Keyboard: ←/→ reorder, ↑/↓ move between zones.'),
      createLayoutEditor({ left: layout.left, right: layout.right }, (next, moved) => {
        this.host.set(['layout', 'left'], next.left);
        this.host.set(['layout', 'right'], next.right);
        this.render();
        (this.body.querySelector(`.mv-le-chip[data-id="${moved}"]`) as HTMLElement | null)?.focus();
      }),
    ];
    out.push(
      this.switchRow('Hide controls while playing', ['layout', 'autoHide'], layout.autoHide),
      this.select('Hide after', ['layout', 'autoHideDelay'], layout.autoHideDelay,
        [[1500, '1.5 s'], [2500, '2.5 s'], [4000, '4 s'], [6000, '6 s']]),
      this.switchRow('Big play button', ['layout', 'centerPlay'], layout.centerPlay),
    );
    return out;
  }

  private playbackTab(): HTMLElement[] {
    const b = this.host.config().behavior;
    return [
      this.switchRow('Autoplay', ['behavior', 'autoplay'], b.autoplay),
      this.switchRow('Remember volume', ['behavior', 'rememberVolume'], b.rememberVolume),
      this.switchRow('Remember speed', ['behavior', 'rememberSpeed'], b.rememberSpeed),
      this.select('Seek step', ['behavior', 'seekStep'], b.seekStep, [[5, '5 s'], [10, '10 s'], [15, '15 s'], [30, '30 s']]),
    ];
  }

  private qualityTab(): HTMLElement[] {
    const q = this.host.config().quality;
    const modes = el('div', 'mv-s-modes');
    modes.setAttribute('role', 'radiogroup');
    modes.setAttribute('aria-label', 'Quality mode');
    MODES.forEach(([value, title, hint]) => {
      const b = btn('', 'mv-s-mode');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(q.mode === value));
      b.append(el('strong', '', title), el('span', '', hint));
      b.addEventListener('click', () => {
        this.host.set(['quality', 'mode'], value);
        this.render();
      });
      modes.append(b);
    });
    return [
      el('div', 'mv-s-sub', 'Automatic quality'),
      modes,
      this.select('Max resolution', ['quality', 'maxHeight'], q.maxHeight ?? 0,
        [[0, 'No limit'], [1080, '1080p'], [720, '720p'], [480, '480p'], [360, '360p']], false, (v) => (Number(v) || null)),
      this.select('Algorithm', ['quality', 'algorithm'], q.algorithm, [
        ['adaptive', 'Adaptive hybrid (recommended)'],
        ['hybrid', 'Hybrid'],
        ['throughput', 'Throughput-based'],
        ['buffer', 'Buffer-based (BBA)'],
      ]),
    ];
  }

  private hotkeysTab(): HTMLElement[] {
    const hk = this.host.config().hotkeys;
    const conflicts = new Set(findConflicts(hk));
    const out: HTMLElement[] = [el('p', 'mv-s-hint', 'Click "Change" and press a key. Esc cancels.')];
    const list = el('div', 'mv-s-keys');
    (Object.keys(HOTKEY_NAMES) as HotkeyAction[]).forEach((action) => {
      const row = el('div', 'mv-s-row');
      row.append(el('span', 'mv-s-label', HOTKEY_NAMES[action]));
      const keys = el('span', 'mv-s-chips');
      (hk[action] ?? []).forEach((k) => {
        const chip = el('kbd', 'mv-s-kbd', keyName(k));
        if (conflicts.has(k.length === 1 ? k.toLowerCase() : k)) {
          chip.classList.add('mv-s-conflict');
          chip.title = 'This key is used by another action';
        }
        keys.append(chip);
      });
      if (!hk[action]?.length) keys.append(el('span', 'mv-s-none', 'none'));
      const change = btn(this.listening === action ? 'Press a key…' : 'Change');
      change.classList.toggle('mv-s-listening', this.listening === action);
      change.addEventListener('click', () => {
        this.listening = this.listening === action ? null : action;
        this.render();
        (this.body.querySelector('.mv-s-listening') as HTMLElement | null)?.focus();
      });
      const clear = btn('✕', 'mv-s-icon', `Remove keys of ${HOTKEY_NAMES[action]}`);
      clear.addEventListener('click', () => {
        this.host.set(['hotkeys', action], []);
        this.render();
      });
      row.append(keys, change, clear);
      list.append(row);
    });
    out.push(list);
    if (conflicts.size) {
      out.push(el('p', 'mv-s-warn', `Keys used twice: ${[...conflicts].map(keyName).join(', ')}. The first action in the list wins.`));
    }
    return out;
  }

  private presetTab(): HTMLElement[] {
    const area = el('textarea', 'mv-s-json');
    area.setAttribute('aria-label', 'Preset JSON');
    area.spellcheck = false;
    area.value = JSON.stringify(this.host.preset(), null, 2);
    const msg = el('p', 'mv-s-hint', 'Only your changes are stored. Copy the text to share the preset or paste one to apply it.');
    const row = el('div', 'mv-s-row mv-s-actions');
    const copy = btn('Copy');
    copy.addEventListener('click', () => {
      area.select();
      navigator.clipboard?.writeText(area.value).then(
        () => (msg.textContent = 'Copied to the clipboard.'),
        () => (msg.textContent = 'Select the text and copy it manually.'),
      );
    });
    const apply = btn('Apply');
    apply.addEventListener('click', () => {
      try {
        const parsed = JSON.parse(area.value || '{}') as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
        this.host.replacePreset(parsed as ViewerPreset);
        this.render();
      } catch {
        msg.textContent = 'This is not a valid preset (JSON object expected).';
        msg.className = 'mv-s-warn';
      }
    });
    const reset = btn('Reset everything', 'mv-s-btn mv-s-danger');
    reset.addEventListener('click', () => {
      this.host.replacePreset({});
      this.render();
    });
    row.append(copy, apply, reset);
    return [msg, area, row];
  }

  // ------------------------------------------------------------------ field builders

  private row(label: string, field: HTMLElement, id: string): HTMLDivElement {
    const row = el('div', 'mv-s-row');
    const l = el('label', 'mv-s-label', label);
    l.htmlFor = id;
    row.append(l, field);
    return row;
  }

  private fieldId(path: string[]): string {
    return `mv-s-${this.id}-${path.join('-')}`;
  }

  private switchRow(label: string, path: string[], value: boolean): HTMLDivElement {
    const input = el('input', 'mv-s-switch');
    input.type = 'checkbox';
    input.id = this.fieldId(path);
    input.checked = value;
    input.addEventListener('change', () => this.host.set(path, input.checked));
    return this.row(label, input, input.id);
  }

  private select<T extends string | number>(
    label: string, path: string[], value: T, options: Array<[T, string]>, allowCustom = false,
    parse: (v: string) => unknown = (v) => (typeof value === 'number' ? Number(v) : v),
  ): HTMLDivElement {
    const wrap = el('span', 'mv-s-select');
    const sel = el('select', 'mv-s-input');
    sel.id = this.fieldId(path);
    options.forEach(([v, text]) => sel.append(new Option(text, String(v))));
    if (allowCustom && !options.some(([v]) => v === value)) sel.append(new Option('Custom', String(value)));
    sel.value = String(value);
    sel.addEventListener('change', () => this.host.set(path, parse(sel.value)));
    wrap.append(sel);
    return this.row(label, wrap, sel.id);
  }

  private range(label: string, path: string[], value: number, min: number, max: number, step: number, fmt: (v: number) => string): HTMLDivElement {
    const wrap = el('span', 'mv-s-range');
    const input = el('input', 'mv-s-slider');
    input.type = 'range';
    input.id = this.fieldId(path);
    Object.assign(input, { min: String(min), max: String(max), step: String(step), value: String(value) });
    const out = el('output', 'mv-s-value', fmt(value));
    const fill = (): void => input.style.setProperty('--p', `${((Number(input.value) - min) / (max - min)) * 100}%`);
    fill();
    input.addEventListener('input', () => {
      fill();
      out.textContent = fmt(Number(input.value));
      this.host.set(path, Number(input.value));
    });
    wrap.append(input, out);
    return this.row(label, wrap, input.id);
  }

  private color(label: string, path: string[], value: string, swatches: string[]): HTMLDivElement {
    const wrap = el('span', 'mv-s-colors');
    const input = el('input', 'mv-s-color');
    input.type = 'color';
    input.id = this.fieldId(path);
    input.value = /^#[\da-f]{6}$/i.test(value) ? value : '#000000';
    const mark = (v: string): void => {
      wrap.querySelectorAll<HTMLButtonElement>('.mv-s-swatch').forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.color === v.toLowerCase())));
    };
    swatches.forEach((c) => {
      const s = btn('', 'mv-s-swatch', `${label}: ${c}`);
      s.dataset.color = c.toLowerCase();
      s.style.background = c;
      s.addEventListener('click', () => {
        input.value = c;
        mark(c);
        this.host.set(path, c);
      });
      wrap.append(s);
    });
    input.addEventListener('input', () => {
      mark(input.value);
      this.host.set(path, input.value);
    });
    wrap.append(input);
    mark(input.value);
    return this.row(label, wrap, input.id);
  }

  // ------------------------------------------------------------------ keyboard

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.listening) {
      e.preventDefault();
      e.stopPropagation();
      if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
      if (e.key !== 'Escape') {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        this.host.set(['hotkeys', this.listening], [key]);
      }
      this.listening = null;
      this.render();
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.close();
      return;
    }
    // Arrow keys switch tabs when a tab has focus (WAI-ARIA tabs pattern).
    const target = e.composedPath()[0] as HTMLElement;
    if (target.classList?.contains('mv-s-tab') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      const ids = TABS.map(([id]) => id);
      const next = ids[(ids.indexOf(this.tab) + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length];
      this.show(next);
      this.tabButtons.get(next)?.focus();
    }
  };
}
