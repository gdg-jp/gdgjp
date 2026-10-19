/**
 * Adapts Web Audio's 128-sample render quanta to the model's hop size.
 *
 * Input collects until a whole hop is there, which `process` turns into a hop
 * of output. Output starts primed with one hop of silence: since quanta and
 * hops are both multiples of 32, the queue then never runs dry, at the cost of
 * one hop (10 ms at 48 kHz) of extra delay.
 */
export class Reframer {
  private readonly input: Float32Array;
  private filled = 0;
  private readonly ring: Float32Array;
  private readPos = 0;
  private available: number;

  constructor(
    readonly hop: number,
    private readonly process: (frame: Float32Array) => Float32Array,
  ) {
    this.input = new Float32Array(hop);
    this.ring = new Float32Array(hop * 4);
    this.available = hop;
  }

  /** Feeds one quantum in and writes the same number of samples out. */
  push(samples: Float32Array, out: Float32Array) {
    for (let i = 0; i < samples.length; ) {
      const take = Math.min(this.hop - this.filled, samples.length - i);
      this.input.set(samples.subarray(i, i + take), this.filled);
      this.filled += take;
      i += take;
      if (this.filled === this.hop) {
        this.filled = 0;
        this.write(this.process(this.input));
      }
    }
    this.read(out);
  }

  private write(frame: Float32Array) {
    const size = this.ring.length;
    // A stall upstream could overfill the ring; drop the oldest audio.
    if (this.available + frame.length > size) {
      const drop = this.available + frame.length - size;
      this.readPos = (this.readPos + drop) % size;
      this.available -= drop;
    }
    let pos = (this.readPos + this.available) % size;
    for (let i = 0; i < frame.length; i++) {
      this.ring[pos] = frame[i] ?? 0;
      pos = pos + 1 === size ? 0 : pos + 1;
    }
    this.available += frame.length;
  }

  private read(out: Float32Array) {
    const size = this.ring.length;
    const n = Math.min(out.length, this.available);
    for (let i = 0; i < n; i++) {
      out[i] = this.ring[this.readPos] ?? 0;
      this.readPos = this.readPos + 1 === size ? 0 : this.readPos + 1;
    }
    out.fill(0, n);
    this.available -= n;
  }
}

/** 95th percentile of the samples (sorts in place). */
export function p95(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(values.length * 0.95))] ?? 0;
}
