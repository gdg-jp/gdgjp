import { type Silence, silencesFromPcm } from "./align";

export type AudioAnalysis = { durationMs: number; silences: Silence[] };

export async function analyzeAudio(blob: Blob): Promise<AudioAnalysis> {
  const ctx = new OfflineAudioContext(1, 1, 44_100);
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / audio.numberOfChannels;
  }
  return {
    durationMs: Math.round(audio.duration * 1000),
    silences: silencesFromPcm(mono, audio.sampleRate),
  };
}
