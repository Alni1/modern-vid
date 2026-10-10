/**
 * Exponentially weighted moving average where the weight of a sample depends on
 * how long it took (a 4 s download moves the estimate more than a 0.2 s one).
 * α_k = 1 − 0.5^(t_k / halfLife), i.e. formula (1.1) with time-dependent α.
 */
class Ewma {
  private estimate = 0;
  private totalWeight = 0;
  constructor(private halfLife: number) {}

  sample(seconds: number, value: number): void {
    const alpha = 1 - Math.pow(0.5, seconds / this.halfLife);
    this.estimate = alpha * value + (1 - alpha) * this.estimate;
    this.totalWeight += seconds;
  }

  /** Bias-corrected value (the estimate starts from zero). */
  get value(): number {
    const zeroFactor = 1 - Math.pow(0.5, this.totalWeight / this.halfLife);
    return zeroFactor > 0 ? this.estimate / zeroFactor : 0;
  }

  get ready(): boolean {
    return this.totalWeight > 0;
  }
}

export interface ThroughputSample {
  bytes: number;
  seconds: number;
  bps: number;
  at: number;
}

/**
 * Network throughput estimator: a fast and a slow EWMA; the more pessimistic
 * of the two is used, so drops are reacted to quickly and spikes are not trusted.
 */
export class ThroughputEstimator {
  private fast = new Ewma(3);
  private slow = new Ewma(9);
  readonly samples: ThroughputSample[] = [];

  constructor(private initialBps = 0) {}

  /** Adds a measured download. Tiny downloads are ignored: their timing is dominated by latency. */
  addSample(bytes: number, seconds: number): void {
    if (bytes < 16_000 || seconds <= 0) return;
    const bps = (bytes * 8) / seconds;
    const weight = Math.max(seconds, 0.05);
    this.fast.sample(weight, bps);
    this.slow.sample(weight, bps);
    this.samples.push({ bytes, seconds, bps, at: performance.now() });
    if (this.samples.length > 100) this.samples.shift();
  }

  /** Current estimate, bits per second (0 when nothing is known). */
  get estimate(): number {
    if (!this.fast.ready) return this.initialBps;
    return Math.min(this.fast.value, this.slow.value);
  }

  get lastSample(): ThroughputSample | undefined {
    return this.samples[this.samples.length - 1];
  }
}
