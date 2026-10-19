/** A short 660 Hz beep on the chosen output device. */
export function playTestTone(sinkId: string) {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const dest = ctx.createMediaStreamDestination();
  osc.frequency.value = 660;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
  osc.connect(gain).connect(dest);
  const audio = new Audio() as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  audio.srcObject = dest.stream;
  const start = () => {
    void audio.play();
    osc.start();
    osc.stop(ctx.currentTime + 0.85);
    setTimeout(() => void ctx.close(), 1200);
  };
  if (sinkId && audio.setSinkId) void audio.setSinkId(sinkId).then(start, start);
  else start();
}

function deviceLabel(d: MediaDeviceInfo, i: number, fallback: string) {
  return d.label || `${fallback} ${i + 1}`;
}
