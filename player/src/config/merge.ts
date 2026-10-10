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
    } else if (Array.isArray(current) ? Array.isArray(value) : typeof value === typeof current) {
      out[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  return out as T;
}

/**
 * Resolves the effective player configuration from the three-level hierarchy:
 * system defaults -> channel author -> viewer.
 * The author may only change appearance (theme); behaviour, layout, hotkeys and
 * accessibility always belong to the viewer. A viewer can opt out of the
 * author's branding with `ignoreAuthorTheme`.
 */
export function resolveConfig(
  author: AuthorPreset | null | undefined,
  viewer: ViewerPreset | null | undefined,
  options: { ignoreAuthorTheme?: boolean } = {},
): PlayerConfig {
  let cfg = deepMerge(DEFAULT_CONFIG, {});
  if (author?.theme && !options.ignoreAuthorTheme) {
    cfg = deepMerge(cfg, { theme: author.theme });
  }
  if (viewer) cfg = deepMerge(cfg, viewer);
  return cfg;
}
