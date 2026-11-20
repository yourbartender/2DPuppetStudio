// Minimal 1€ filter for smoothing noisy landmark signals.
// Reference: Casiez et al., "1€ Filter".

class LowPass {
  private y: number | null = null;
  filter(value: number, alpha: number) {
    this.y = this.y == null ? value : alpha * value + (1 - alpha) * this.y;
    return this.y;
  }
  reset() {
    this.y = null;
  }
}

export class OneEuro {
  private xFilter = new LowPass();
  private dxFilter = new LowPass();
  private lastTime: number | null = null;
  private prevValue: number | null = null;

  constructor(
    public minCutoff = 1.0,
    public beta = 0.0,
    public dCutoff = 1.0,
  ) {}

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, timestampMs: number) {
    if (this.lastTime == null) {
      this.lastTime = timestampMs;
      this.prevValue = value;
      return this.xFilter.filter(value, 1);
    }
    const dt = Math.max((timestampMs - this.lastTime) / 1000, 1e-6);
    this.lastTime = timestampMs;
    const dx = ((value - (this.prevValue ?? value)) ) / dt;
    this.prevValue = value;
    const edx = this.dxFilter.filter(dx, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilter.filter(value, this.alpha(cutoff, dt));
  }

  reset() {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = null;
    this.prevValue = null;
  }
}

export class LandmarkSmoother {
  private filters = new Map<string, OneEuro>();
  constructor(private minCutoff: number, private beta: number) {}
  setParams(minCutoff: number, beta: number) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.filters.forEach((f) => {
      f.minCutoff = minCutoff;
      f.beta = beta;
    });
  }
  filter(key: string, value: number, t: number) {
    let f = this.filters.get(key);
    if (!f) {
      f = new OneEuro(this.minCutoff, this.beta);
      this.filters.set(key, f);
    }
    return f.filter(value, t);
  }
  reset() {
    this.filters.forEach((f) => f.reset());
  }
}
