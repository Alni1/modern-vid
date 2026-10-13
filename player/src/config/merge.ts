import { DEFAULT_CONFIG } from './defaults';
import type { AuthorPreset, PlayerConfig, ViewerPreset } from './types';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep merge where arrays and primitives from `patch` replace the base value. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch) || !isPlainObject(base)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || !(key in out)) continue; // ignore unknown keys
    const current = out[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = deepMerge(current, value);
    } else if (
      Array.isArray(current) ? Array.isArray(value)
        : current === null || value === null ? true // nullable fields such as quality.maxHeight
          : typeof value === typeof current
    ) {
      out[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  return out as T;
}

/**
 * Resolves the effective player configuration from the three-level hierarchy
 * (system defaults, channel author, viewer):
 *   - behaviour, layout, quality and hotkeys always come from the viewer;
 *   - the look (theme) of a channel that defines its own theme comes from the author,
 *     unless the viewer turned it off (behavior.useAuthorTheme = false or `ignoreAuthorTheme`);
 *     the viewer's own theme is used on channels without a theme;
 *   - the button size stays the viewer's choice when they set it (accessibility).
 */
export function resolveConfig(
  author: AuthorPreset | null | undefined,
  viewer: ViewerPreset | null | undefined,
  options: { ignoreAuthorTheme?: boolean } = {},
): PlayerConfig {
  let cfg = deepMerge(DEFAULT_CONFIG, viewer ?? {});
  const optedOut = options.ignoreAuthorTheme || viewer?.behavior?.useAuthorTheme === false;
  if (author?.theme && !optedOut) {
    const authorTheme: Record<string, unknown> = { ...author.theme };
    if (viewer?.theme?.controlSize) delete authorTheme.controlSize;
    cfg = deepMerge(cfg, { theme: authorTheme });
  }
  return cfg;
}
