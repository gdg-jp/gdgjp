import { describe, expect, it } from "vitest";
import { DEFAULT_DENOISE, EMPTY_REPORT, type Peer } from "./protocol";
import { controlRoomRefs, outputRefs } from "./pulls";

const TRACKS = { mic: "mic", camera: "camera", screen: "screen", screenAudio: "screenAudio" };

function speaker(id: string, patch: Partial<Peer> = {}): Peer {
  return {
    ...EMPTY_REPORT,
    id,
    role: "speaker",
    name: id,
    online: true,
    since: 0,
    denoise: DEFAULT_DENOISE,
    sfuSessionId: `sfu-${id}`,
    tracks: TRACKS,
    cam: true,
    screen: true,
    screenAudio: true,
    ...patch,
  };
}

const names = (refs: { sessionId: string; trackName: string }[]) =>
  refs.map((r) => `${r.sessionId}/${r.trackName}`);

describe("controlRoomRefs", () => {
  it("pulls video only for speakers in a slot, audio for everyone", () => {
    const refs = controlRoomRefs([speaker("a"), speaker("b")], { A: "a", B: null });
    expect(names(refs)).toEqual([
      "sfu-a/mic",
      "sfu-a/camera",
      "sfu-a/screen",
      "sfu-a/screenAudio",
      "sfu-b/mic",
      "sfu-b/screenAudio",
    ]);
  });

  it("skips devices that are off and speakers that are offline or unpublished", () => {
    const refs = controlRoomRefs(
      [
        speaker("a", { cam: false, screen: false, screenAudio: false }),
        speaker("b", { online: false }),
        speaker("c", { sfuSessionId: null }),
      ],
      { A: "a", B: "b", C: "c" },
    );
    expect(names(refs)).toEqual(["sfu-a/mic"]);
  });
});

describe("simulcast layer picks", () => {
  const layered = speaker("a", { simulcast: { camera: true, screen: true } });

  it("control room asks for low layers, only where the speaker sends layers", () => {
    const picks = (p: Peer) =>
      controlRoomRefs([p], { A: p.id }).map((r) => [r.trackName, r.simulcast?.preferredRid]);
    expect(picks(layered)).toEqual([
      ["mic", undefined],
      ["camera", "q"],
      ["screen", "h"],
      ["screenAudio", undefined],
    ]);
    expect(picks(speaker("b", { simulcast: { camera: true, screen: false } }))).toEqual([
      ["mic", undefined],
      ["camera", "q"],
      ["screen", undefined],
      ["screenAudio", undefined],
    ]);
  });

  it("OBS asks for the full layer and may step down when it is gone", () => {
    expect(outputRefs(layered, "camera")).toEqual([
      {
        sessionId: "sfu-a",
        trackName: "camera",
        simulcast: {
          preferredRid: "f",
          priorityOrdering: "asciibetical",
          ridNotAvailable: "asciibetical",
        },
      },
    ]);
    expect(outputRefs(layered, "screen").map((r) => r.trackName)).toEqual([
      "screen",
      "screenAudio",
    ]);
    expect(outputRefs(speaker("b"), "camera")[0]?.simulcast).toBeUndefined();
    expect(outputRefs(layered, "mic")).toEqual([{ sessionId: "sfu-a", trackName: "mic" }]);
    expect(outputRefs(speaker("c", { online: false }), "camera")).toEqual([]);
  });
});
