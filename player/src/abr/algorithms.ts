import type { Level } from '../streaming/m3u8';

/** Viewer-facing quality modes (see the customization settings). */
export type AbrMode = 'balanced' | 'eco' | 'stable' | 'quality';

/** Everything an ABR algorithm may look at when choosing the next segment's level. */
export interface AbrContext {
  /** Levels sorted from the lowest to the highest bitrate. */
  levels: Level[];
  /** Level of the previously loaded segment (−1 before the first segment). */
  currentLevel: number;
  /** Throughput estimate, bits per second (0 if unknown). */
  throughput: number;
  /** Seconds of media buffered ahead of the playhead. */
  buffer: number;
  /** Target size of the forward buffer, seconds. */
  maxBuffer: number;
  /** Duration of the next segment, seconds. */
  segmentDuration: number;
  /** Seconds of media loaded at the current level since the last switch. */
  sinceSwitch: number;
  /** Highest level index allowed by the viewer's constraints (max resolution, mode). */
  maxAllowed: number;
  mode: AbrMode;
}

export interface AbrAlgorithm {
  readonly id: AbrAlgorithmId;
  readonly title: string;
  chooseLevel(ctx: AbrContext): number;
  reset?(): void;
}

export type AbrAlgorithmId = 'throughput' | 'buffer' | 'hybrid' | 'adaptive';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Highest level whose bitrate does not exceed `limitBps`, never above maxAllowed. */
export function highestBelow(levels: Level[], limitBps: number, maxAllowed: number): number {
  let best = 0;
  for (let i = 0; i <= maxAllowed && i < levels.length; i++) {
    if (levels[i].bitrate <= limitBps) best = i;
  }
  return best;
}

/**
 * Throughput-based rule (hls.js-like): R(k+1) = max{ r_i : r_i ≤ β·Ĉ }.
 */
export class ThroughputRule implements AbrAlgorithm {
  readonly id = 'throughput' as const;
  readonly title = 'Throughput (EWMA)';
  constructor(private safety = 0.85) {}

  chooseLevel(ctx: AbrContext): number {
    if (!ctx.throughput) return 0;
    return highestBelow(ctx.levels, this.safety * ctx.throughput, ctx.maxAllowed);
  }
}

/**
 * Buffer-based rule (BBA-0, Huang et al.): the buffer level is mapped to a bitrate
 * by a piecewise-linear function — the lowest level below the reservoir, the highest
 * above reservoir + cushion and linear interpolation in between.
 */
export class BufferRule implements AbrAlgorithm {
  readonly id = 'buffer' as const;
  readonly title = 'Buffer (BBA)';

  chooseLevel(ctx: AbrContext): number {
    const { levels, buffer, maxBuffer, maxAllowed } = ctx;
    const reservoir = Math.min(8, maxBuffer * 0.25);
    const cushion = Math.max(maxBuffer * 0.6, reservoir + ctx.segmentDuration);
    const top = Math.min(maxAllowed, levels.length - 1);
    if (buffer <= reservoir) return 0;
    if (buffer >= reservoir + cushion) return top;
    const rMin = levels[0].bitrate;
    const rMax = levels[top].bitrate;
    const target = rMin + ((buffer - reservoir) / cushion) * (rMax - rMin);
    return highestBelow(levels, target, top);
  }
}

/**
 * Hybrid rule (similar to dash.js DYNAMIC): throughput rule while the buffer is
 * small, buffer rule once it is large; hysteresis prevents flapping between them.
 */
export class HybridRule implements AbrAlgorithm {
  readonly id = 'hybrid' as const;
  readonly title = 'Hybrid (throughput ↔ buffer)';
  private useBuffer = false;
  private throughputRule = new ThroughputRule(0.9);
  private bufferRule = new BufferRule();

  chooseLevel(ctx: AbrContext): number {
    const high = Math.min(10, ctx.maxBuffer * 0.4);
    const low = high * 0.6;
    if (!this.useBuffer && ctx.buffer >= high) this.useBuffer = true;
    else if (this.useBuffer && ctx.buffer < low) this.useBuffer = false;
    return this.useBuffer ? this.bufferRule.chooseLevel(ctx) : this.throughputRule.chooseLevel(ctx);
  }

  reset(): void {
    this.useBuffer = false;
  }
}

interface ModeParams {
  betaMin: number;
  betaMax: number;
  /** Buffer needed before switching up, as a fraction of maxBuffer. */
  upBuffer: number;
  /** Minimum media time loaded on a level before switching up, seconds. */
  holdTime: number;
  /** Buffer that must remain after downloading the next segment, seconds. */
  reserve: number;
}

const MODE_PARAMS: Record<AbrMode, ModeParams> = {
  balanced: { betaMin: 0.6, betaMax: 1.05, upBuffer: 0.3, holdTime: 8, reserve: 4 },
  quality: { betaMin: 0.7, betaMax: 1.15, upBuffer: 0.2, holdTime: 4, reserve: 3 },
  stable: { betaMin: 0.55, betaMax: 0.9, upBuffer: 0.5, holdTime: 20, reserve: 6 },
  eco: { betaMin: 0.5, betaMax: 0.85, upBuffer: 0.4, holdTime: 12, reserve: 5 },
};

/**
 * Improved hybrid algorithm proposed in this work (adaptive safety factor + user constraints).
 *
 * 1. Buffer-dependent safety factor: β(B) = β_min + (β_max − β_min)·clamp((B − B_low)/(B_high − B_low), 0, 1).
 *    With an empty buffer the throughput estimate is trusted less, with a full buffer more.
 * 2. Candidate: R* = max{ r_i ≤ β(B)·Ĉ, i ≤ i_max }, where i_max comes from the viewer's
 *    constraints (max resolution, quality mode).
 * 3. Down-switch guard: if downloading the next segment at the current level would leave
 *    less than B_reserve seconds of buffer (B − r_cur·d/Ĉ < B_reserve), switch down at once
 *    to the highest level that keeps the reserve.
 * 4. Up-switch hysteresis: switch up only when B ≥ B_up and at least t_hold seconds of media
 *    were loaded at the current level; one level at a time, but straight to the candidate when
 *    the buffer is almost full (B ≥ B_high), where a wrong decision cannot cause a stall.
 * 5. Buffer as a cushion: with B ≥ B_up a lower candidate does not cause a down-switch by itself;
 *    the level is kept while the guard (3) allows it, so short throughput drops are absorbed.
 * β_max slightly above 1 lets a full buffer cover a small deficit (as buffer-based rules do);
 * the down-switch guard (3) keeps this safe.
 * The parameters depend on the viewer's mode (balanced / quality / stable / eco).
 */
export class AdaptiveHybridRule implements AbrAlgorithm {
  readonly id = 'adaptive' as const;
  readonly title = 'Adaptive hybrid (proposed)';

  chooseLevel(ctx: AbrContext): number {
    const p = MODE_PARAMS[ctx.mode] ?? MODE_PARAMS.balanced;
    const { levels, throughput: C, buffer: B, segmentDuration: d } = ctx;
    const top = Math.min(ctx.maxAllowed, levels.length - 1);
    if (!C) return Math.min(ctx.currentLevel < 0 ? 0 : ctx.currentLevel, top);

    const bLow = d;
    const bHigh = Math.max(bLow + d, ctx.maxBuffer * 0.7);
    const beta = p.betaMin + (p.betaMax - p.betaMin) * clamp((B - bLow) / (bHigh - bLow), 0, 1);
    const candidate = highestBelow(levels, beta * C, top);

    const cur = ctx.currentLevel;
    if (cur < 0) return candidate; // first segment
    const current = Math.min(cur, top);

    // 3. Down-switch guard: would the next segment at the current level drain the buffer?
    const downloadTime = (levels[current].bitrate * d) / C;
    if (B - downloadTime < p.reserve) {
      let safe = 0;
      for (let i = 0; i <= top; i++) if (B - (levels[i].bitrate * d) / C >= p.reserve) safe = i;
      return Math.min(safe, candidate, current);
    }
    // While the buffer is comfortable the level is kept even if the estimate fell below it:
    // the buffer absorbs short drops, and the guard (3) still switches down in time.
    if (candidate < current) return B >= p.upBuffer * ctx.maxBuffer ? current : candidate;

    // 4. Up-switch hysteresis: one level at a time, straight to the candidate with a full buffer.
    if (candidate > current && B >= p.upBuffer * ctx.maxBuffer && ctx.sinceSwitch >= p.holdTime) {
      return B >= bHigh ? candidate : current + 1;
    }
    return current;
  }
}

export function createAbr(id: AbrAlgorithmId): AbrAlgorithm {
  switch (id) {
    case 'throughput': return new ThroughputRule();
    case 'buffer': return new BufferRule();
    case 'hybrid': return new HybridRule();
    default: return new AdaptiveHybridRule();
  }
}

/** Highest level index allowed by the viewer's constraints. */
export function maxAllowedLevel(levels: Level[], maxHeight: number | null, mode: AbrMode): number {
  const capHeight = mode === 'eco' ? Math.min(maxHeight ?? Infinity, 480) : maxHeight ?? Infinity;
  let idx = 0;
  levels.forEach((l, i) => {
    const h = Math.min(l.width, l.height) || l.height;
    if (h <= capHeight) idx = i;
  });
  return idx;
}
