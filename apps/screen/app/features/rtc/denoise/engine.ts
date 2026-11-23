import workletUrl from "./denoise.worklet.ts?worker&url";
import dfnAssets from "./dfn-assets.json";
import type { FromWorklet, ToWorklet, WorkletOptions } from "./worklet-messages";

export const DFN_BASE = `/dfn/${dfnAssets.version}`;
const WASM_URL = `${DFN_BASE}/${dfnAssets.wasm}`;
const MODEL_URL = `${DFN_BASE}/${dfnAssets.model}`;

const READY_TIMEOUT_MS = 15_000;

type Assets = { module: WebAssembly.Module; model: ArrayBuffer };

// The smallest module using a v128 instruction (from wasm-feature-detect).
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
]);

function isMobile(): boolean {
  const data = (navigator as { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (typeof data?.mobile === "boolean") return data.mobile;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function denoiseSupported(): boolean {
  if (typeof window === "undefined" || isMobile()) return false;
  if (typeof AudioWorkletNode === "undefined" || typeof WebAssembly === "undefined") return false;
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

let assets: Promise<Assets> | null = null;

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res;
}

export function loadDenoiseAssets(): Promise<Assets> {
  if (!assets) {
    assets = Promise.all([
      fetchOk(WASM_URL)
        .then((res) => res.arrayBuffer())
        .then((buf) => WebAssembly.compile(buf)),
      fetchOk(MODEL_URL).then((res) => res.arrayBuffer()),
    ]).then(([module, model]) => ({ module, model }));
    assets.catch(() => {
      assets = null;
    });
  }
  return assets;
}

export type PipelineEvent = { type: "overload" } | { type: "failed"; message: string };

export class DenoisePipeline {
  readonly track: MediaStreamTrack;
  private source: MediaStreamAudioSourceNode | null = null;
  private input: MediaStreamTrack | null = null;

  private constructor(
    readonly ctx: AudioContext,
    private readonly node: AudioWorkletNode,
    dest: MediaStreamAudioDestinationNode,
  ) {
    const track = dest.stream.getAudioTracks()[0];
    if (!track) throw new Error("no destination track");
    this.track = track;
  }

  static async create(
    attenDb: number,
    onEvent: (e: PipelineEvent) => void,
  ): Promise<DenoisePipeline> {
    const { module, model } = await loadDenoiseAssets();
    const ctx = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
    try {
      await ctx.audioWorklet.addModule(workletUrl);
      const processorOptions: WorkletOptions = { module, model, attenDb };
      const node = new AudioWorkletNode(ctx, "dfn-denoise", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: "explicit",
        outputChannelCount: [1],
        processorOptions,
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("worklet timeout")), READY_TIMEOUT_MS);
        node.port.onmessage = (e: MessageEvent<FromWorklet>) => {
          const msg = e.data;
          if (msg.type === "ready") {
            clearTimeout(timer);
            resolve();
          } else if (msg.type === "error") {
            clearTimeout(timer);
            reject(new Error(msg.message));
          }
        };
        node.onprocessorerror = () => {
          clearTimeout(timer);
          reject(new Error("processor error"));
        };
      });
      node.port.onmessage = (e: MessageEvent<FromWorklet>) => {
        if (e.data.type === "load" && e.data.p95Ms > e.data.hopMs) onEvent({ type: "overload" });
      };
      node.onprocessorerror = () => onEvent({ type: "failed", message: "processor error" });
      const dest = ctx.createMediaStreamDestination();
      dest.channelCount = 1;
      node.connect(dest);
      return new DenoisePipeline(ctx, node, dest);
    } catch (err) {
      void ctx.close();
      throw err;
    }
  }

  setInput(track: MediaStreamTrack | null) {
    if (track === this.input) return;
    this.source?.disconnect();
    this.source = null;
    this.input = null;
    if (!track) return;
    // Firefox refuses a source whose rate differs from the context's.
    const source = this.ctx.createMediaStreamSource(new MediaStream([track]));
    source.connect(this.node);
    this.source = source;
    this.input = track;
  }

  setAtten(db: number) {
    const msg: ToWorklet = { type: "atten", db };
    this.node.port.postMessage(msg);
  }

  close() {
    this.setInput(null);
    this.track.stop();
    void this.ctx.close();
  }
}
