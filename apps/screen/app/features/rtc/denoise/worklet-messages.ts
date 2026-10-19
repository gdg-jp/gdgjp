/** Messages between the denoise worklet and the page. */

export type WorkletOptions = {
  module: WebAssembly.Module;
  /** DeepFilterNet3_onnx.tar.gz bytes. */
  model: ArrayBuffer;
  attenDb: number;
};

export type ToWorklet = { type: "atten"; db: number };

export type FromWorklet =
  | { type: "ready"; hop: number }
  | { type: "error"; message: string }
  /** Per-frame processing time over the last ~2 s, against the hop's real-time budget. */
  | { type: "load"; p95Ms: number; hopMs: number };
