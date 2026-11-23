export type WorkletOptions = {
  module: WebAssembly.Module;
  model: ArrayBuffer;
  attenDb: number;
};

export type ToWorklet = { type: "atten"; db: number };

export type FromWorklet =
  | { type: "ready"; hop: number }
  | { type: "error"; message: string }
  | { type: "load"; p95Ms: number; hopMs: number };
