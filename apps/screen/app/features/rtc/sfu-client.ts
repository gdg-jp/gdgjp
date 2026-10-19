/**
 * One page's Cloudflare Realtime SFU session: a single RTCPeerConnection that
 * pushes this page's tracks and pulls other pages' tracks. All calls go
 * through the Worker's `/rtc/<stageId>/…` proxy, which holds the app secret.
 *
 * Every SDP exchange is serialized (the SFU requires one negotiation at a
 * time per session). On ICE failure the owner throws the whole connection
 * away and builds a new one — simpler and more reliable than ICE restarts.
 */

export type PushKey = "mic" | "camera" | "screen" | "screenAudio";

export type PushSpec = {
  key: PushKey;
  kind: "audio" | "video";
  track: MediaStreamTrack | null;
  maxBitrate?: number;
  degradation?: RTCDegradationPreference;
};

export type RemoteRef = { sessionId: string; trackName: string };

export type PulledTrack = RemoteRef & { mid: string; track: MediaStreamTrack };

type TrackResult = {
  mid?: string;
  trackName?: string;
  sessionId?: string;
  errorCode?: string;
  errorDescription?: string;
};

type TracksResponse = {
  requiresImmediateRenegotiation?: boolean;
  sessionDescription?: RTCSessionDescriptionInit;
  tracks?: TrackResult[];
  errorCode?: string;
  errorDescription?: string;
};

export const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];

/** How long ICE may stay "disconnected" before we give up and rebuild. */
const DISCONNECTED_GRACE_MS = 5000;

export function remoteKey(ref: RemoteRef): string {
  return `${ref.sessionId}/${ref.trackName}`;
}

export class SfuError extends Error {}

export class SfuConnection {
  readonly pc: RTCPeerConnection;
  sessionId: string | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private senders = new Map<PushKey, RTCRtpSender>();
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(
    private readonly stageId: string,
    /** "invite:<token>" / "output:<token>"; null = session cookie (operator). */
    private readonly auth: string | null,
    private readonly onFailed: () => void,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: "max-bundle" });
    this.pc.addEventListener("iceconnectionstatechange", this.onIceState);
  }

  get iceState(): RTCIceConnectionState {
    return this.pc.iceConnectionState;
  }

  close() {
    this.closed = true;
    clearTimeout(this.disconnectTimer);
    this.pc.removeEventListener("iceconnectionstatechange", this.onIceState);
    this.pc.close();
  }

  private onIceState = () => {
    const state = this.pc.iceConnectionState;
    clearTimeout(this.disconnectTimer);
    if (this.closed) return;
    if (state === "failed") this.onFailed();
    else if (state === "disconnected") {
      this.disconnectTimer = setTimeout(() => {
        if (!this.closed && this.pc.iceConnectionState !== "connected") this.onFailed();
      }, DISCONNECTED_GRACE_MS);
    }
  };

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.auth) headers["x-screen-auth"] = this.auth;
    const res = await fetch(`/rtc/${this.stageId}/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    const json = (await res.json().catch(() => ({}))) as T & {
      errorCode?: string;
      errorDescription?: string;
    };
    if (!res.ok || json.errorCode) {
      throw new SfuError(json.errorDescription || json.errorCode || `SFU ${res.status}`);
    }
    return json;
  }

  async open(): Promise<string> {
    const res = await this.api<{ sessionId: string }>("POST", "sessions/new");
    this.sessionId = res.sessionId;
    return res.sessionId;
  }

  /**
   * Publish one transceiver per spec. A spec may start without a track
   * (camera off, not sharing yet); `replace()` attaches it later without any
   * renegotiation, so toggling devices never touches the SFU.
   */
  push(specs: PushSpec[]): Promise<void> {
    return this.serial(async () => {
      const sid = this.requireSession();
      const transceivers = specs.map((spec) =>
        this.pc.addTransceiver(spec.track ?? spec.kind, { direction: "sendonly" }),
      );
      await this.pc.setLocalDescription(await this.pc.createOffer());
      const res = await this.api<TracksResponse>("POST", `sessions/${sid}/tracks/new`, {
        sessionDescription: { type: "offer", sdp: this.pc.localDescription?.sdp },
        tracks: specs.map((spec, i) => ({
          location: "local",
          mid: transceivers[i]?.mid,
          trackName: spec.key,
        })),
      });
      const failed = res.tracks?.find((t) => t.errorCode);
      if (failed) throw new SfuError(failed.errorDescription || failed.errorCode);
      if (!res.sessionDescription) throw new SfuError("no answer");
      await this.pc.setRemoteDescription(res.sessionDescription);
      specs.forEach((spec, i) => {
        const sender = transceivers[i]?.sender;
        if (!sender) return;
        this.senders.set(spec.key, sender);
        void tuneSender(sender, spec);
      });
    });
  }

  async replace(key: PushKey, track: MediaStreamTrack | null): Promise<void> {
    const sender = this.senders.get(key);
    if (sender && sender.track !== track) await sender.replaceTrack(track);
  }

  /** Pull remote tracks; entries the SFU refused come back as missing. */
  pull(refs: RemoteRef[]): Promise<PulledTrack[]> {
    if (refs.length === 0) return Promise.resolve([]);
    return this.serial(async () => {
      const sid = this.requireSession();
      const res = await this.api<TracksResponse>("POST", `sessions/${sid}/tracks/new`, {
        tracks: refs.map((r) => ({ location: "remote", ...r })),
      });
      if (res.requiresImmediateRenegotiation && res.sessionDescription) {
        await this.pc.setRemoteDescription(res.sessionDescription);
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        await this.api("PUT", `sessions/${sid}/renegotiate`, {
          sessionDescription: { type: "answer", sdp: this.pc.localDescription?.sdp },
        });
      }
      const pulled: PulledTrack[] = [];
      for (const t of res.tracks ?? []) {
        if (t.errorCode || !t.mid || !t.trackName || !t.sessionId) continue;
        const transceiver = this.pc.getTransceivers().find((x) => x.mid === t.mid);
        if (!transceiver) continue;
        pulled.push({
          sessionId: t.sessionId,
          trackName: t.trackName,
          mid: t.mid,
          track: transceiver.receiver.track,
        });
      }
      return pulled;
    });
  }

  /** Stop receiving the given mids. */
  unpull(mids: string[]): Promise<void> {
    if (mids.length === 0) return Promise.resolve();
    return this.serial(async () => {
      const sid = this.requireSession();
      for (const t of this.pc.getTransceivers()) {
        if (t.mid && mids.includes(t.mid) && t.currentDirection !== "stopped") t.stop();
      }
      await this.pc.setLocalDescription(await this.pc.createOffer());
      const res = await this.api<TracksResponse>("PUT", `sessions/${sid}/tracks/close`, {
        tracks: mids.map((mid) => ({ mid })),
        sessionDescription: { type: "offer", sdp: this.pc.localDescription?.sdp },
        force: false,
      });
      if (res.sessionDescription) await this.pc.setRemoteDescription(res.sessionDescription);
    });
  }

  async stats(): Promise<RTCStatsReport | null> {
    try {
      return await this.pc.getStats();
    } catch {
      return null;
    }
  }

  private requireSession(): string {
    if (!this.sessionId) throw new SfuError("no session");
    if (this.closed) throw new SfuError("closed");
    return this.sessionId;
  }
}

async function tuneSender(sender: RTCRtpSender, spec: PushSpec) {
  if (spec.kind !== "video") return;
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    for (const enc of params.encodings) {
      if (spec.maxBitrate) enc.maxBitrate = spec.maxBitrate;
      enc.maxFramerate = 30;
    }
    if (spec.degradation) params.degradationPreference = spec.degradation;
    await sender.setParameters(params);
  } catch {
    // Older browsers reject some fields; defaults are still fine.
  }
}
