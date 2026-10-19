/**
 * AudioWorklet processor running DeepFilterNet3 (libDF built to wasm, see
 * scripts/dfn/build.sh) on a mono 48 kHz mic. Bundled on its own through
 * Vite's `?worker&url`, so the glue and polyfill ride along.
 *
 * The main thread compiles the wasm and fetches the model, then hands both
 * over in `processorOptions`; nothing here touches the network.
 */
import "./worklet-polyfill";
import {
  df_create,
  df_get_frame_length,
  df_process_frame,
  df_set_atten_lim,
  initSync,
} from "./df-glue.js";
import { Reframer, p95 } from "./reframer";
import type { FromWorklet, ToWorklet, WorkletOptions } from "./worklet-messages";

declare const AudioWorkletProcessor: {
  prototype: { readonly port: MessagePort };
  new (): { readonly port: MessagePort };
};
declare function registerProcessor(name: string, ctor: unknown): void;

/** Frames between load reports (about 2 s at a 10 ms hop). */
const REPORT_EVERY = 200;

class DenoiseProcessor extends AudioWorkletProcessor {
  private reframer: Reframer | null = null;
  private timings: number[] = [];

  constructor(options: { processorOptions: WorkletOptions }) {
    super();
    const { module, model, attenDb } = options.processorOptions;
    try {
      initSync({ module });
      const state = df_create(new Uint8Array(model), attenDb);
      const hop = df_get_frame_length(state);
      this.reframer = new Reframer(hop, (frame) => {
        const start = Date.now();
        const out = df_process_frame(state, frame);
        this.timings.push(Date.now() - start);
        if (this.timings.length >= REPORT_EVERY) {
          this.post({ type: "load", p95Ms: p95(this.timings), hopMs: (hop / sampleRate) * 1000 });
          this.timings = [];
        }
        return out;
      });
      this.port.onmessage = (e: MessageEvent<ToWorklet>) => {
        if (e.data.type === "atten") df_set_atten_lim(state, e.data.db);
      };
      this.post({ type: "ready", hop });
    } catch (err) {
      this.post({ type: "error", message: String(err) });
    }
  }

  private post(msg: FromWorklet) {
    this.port.postMessage(msg);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    const out = outputs[0]?.[0];
    if (!out) return true;
    // Disconnected (noise suppression off): no input, nothing to spend CPU on.
    if (!input || !this.reframer) {
      out.fill(0);
      return true;
    }
    this.reframer.push(input, out);
    return true;
  }
}

declare const sampleRate: number;

registerProcessor("dfn-denoise", DenoiseProcessor);
