import { env, pipeline } from "@huggingface/transformers";

const MODEL = "intfloat/multilingual-e5-small";
const DIMENSIONS = 384;

// @huggingface/transformers (unlike Python transformers) never reads HF_HOME; it only
// honors env.cacheDir. Bridge the two so the HF_HOME the systemd unit sets actually takes
// effect, instead of falling back to the library's own (read-only, root-owned) install dir.
if (process.env.HF_HOME) {
  env.cacheDir = process.env.HF_HOME;
}

export type Embedder = { embed(text: string, query: boolean): Promise<Float32Array> };

let shared: Promise<Embedder> | undefined;

export async function createEmbedder(): Promise<Embedder> {
  const extractor = await pipeline("feature-extraction", MODEL, { dtype: "fp32" });
  return {
    async embed(text, query) {
      const result = await extractor(`${query ? "query" : "passage"}: ${text}`, {
        pooling: "mean",
        normalize: true,
      });
      const values = result.data as Float32Array;
      if (values.length !== DIMENSIONS)
        throw new Error(`Expected ${DIMENSIONS}-dimension embedding, got ${values.length}`);
      return values;
    },
  };
}

export function defaultEmbedder(): Promise<Embedder> {
  shared ??= createEmbedder();
  return shared;
}
