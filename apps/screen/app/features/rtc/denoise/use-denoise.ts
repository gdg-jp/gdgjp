import { useEffect, useRef, useState } from "react";
import type { DenoiseSetting, DenoiseState } from "~/features/stage/protocol";
import { DenoisePipeline, denoiseSupported, loadDenoiseAssets } from "./engine";

const RETRY_MS = 30_000;

/**
 * Decides what this page's mic sends: the DeepFilterNet3 output while it
 * actually runs, otherwise the raw mic with the browser's own suppression
 * (`setBrowserSuppression`) turned back on. Switching between the two is one
 * `replaceTrack`, so nothing renegotiates.
 *
 * Falls back (never silently drops audio) while assets load, when the
 * browser cannot run it, when the AudioContext is not allowed to start yet,
 * and once a frame takes longer than real time (overload, sticky until the
 * operator turns it off and on again).
 */
export function useDenoise(
  mic: MediaStreamTrack | null,
  setting: DenoiseSetting,
  setBrowserSuppression: (on: boolean) => void,
): { track: MediaStreamTrack | null; state: DenoiseState } {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [pipeline, setPipeline] = useState<DenoisePipeline | null>(null);
  const [failed, setFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const [overload, setOverload] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const attenRef = useRef(setting.attenDb);
  attenRef.current = setting.attenDb;
  const pipelineRef = useRef<DenoisePipeline | null>(null);
  const mounted = useRef(false);

  useEffect(() => setSupported(denoiseSupported()), []);

  // Build the pipeline the first time it is wanted; keep it for the page's
  // life, since loading the model takes a while.
  const wanted = setting.on && supported === true;
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt forces a retry
  useEffect(() => {
    if (!wanted || pipelineRef.current) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    DenoisePipeline.create(attenRef.current, (e) => {
      if (e.type === "overload") setOverload(true);
      else setFailed(true);
    })
      .then((p) => {
        if (cancelled || !mounted.current) return p.close();
        pipelineRef.current = p;
        setFailed(false);
        setPipeline(p);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("noise suppression unavailable", err);
        setFailed(true);
        retry = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
      });
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [wanted, attempt]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pipelineRef.current?.close();
      pipelineRef.current = null;
    };
  }, []);

  // Browsers may hold the context until the user interacts with the page.
  useEffect(() => {
    if (!pipeline) return;
    const ctx = pipeline.ctx;
    const update = () => setRunning(ctx.state === "running");
    const resume = () => {
      if (ctx.state !== "running") void ctx.resume().catch(() => {});
    };
    ctx.addEventListener("statechange", update);
    for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, resume, true);
    resume();
    update();
    return () => {
      ctx.removeEventListener("statechange", update);
      for (const ev of ["pointerdown", "keydown"]) window.removeEventListener(ev, resume, true);
    };
  }, [pipeline]);

  useEffect(() => {
    if (setting.on) return;
    setOverload(false);
  }, [setting.on]);

  useEffect(() => pipeline?.setAtten(setting.attenDb), [pipeline, setting.attenDb]);

  const feed = setting.on && !overload ? mic : null;
  useEffect(() => {
    if (!pipeline) return;
    try {
      pipeline.setInput(feed);
    } catch (err) {
      console.warn("noise suppression cannot take this mic", err);
      setFailed(true);
    }
  }, [pipeline, feed]);

  // Not tied to `mic`: it is briefly null while reopening, and flipping the
  // browser's suppression on that would reopen it again.
  const active = setting.on && !overload && !failed && running && pipeline !== null;
  useEffect(() => setBrowserSuppression(!active), [active, setBrowserSuppression]);

  let state: DenoiseState;
  if (!setting.on) state = "off";
  else if (supported === false || failed) state = "unsupported";
  else if (overload) state = "overload";
  else if (active) state = "active";
  else state = "loading";

  return { track: active && pipeline ? pipeline.track : mic, state };
}

/** Starts the asset download early (the lobby) where the browser can use it. */
export function preloadDenoise() {
  if (denoiseSupported()) void loadDenoiseAssets().catch(() => {});
}
