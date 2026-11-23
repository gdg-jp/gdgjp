import { WorkerEntrypoint } from "cloudflare:workers";
import {
  type DurableObjectSnapshot,
  type StagingSnapshotInstance,
  type StagingSnapshotService,
  assertStagingSlot,
} from "@gdgjp/gdg-lib/staging-snapshot";
import { tracks } from "../app/features/clips/catalog";
import { roomName } from "../app/features/playback/protocol";

const BINDING = "MC_ROOM";

export class StagingSnapshot extends WorkerEntrypoint<Env> implements StagingSnapshotService {
  async instances(): Promise<StagingSnapshotInstance[]> {
    return tracks.map((track) => ({ binding: BINDING, name: roomName(track) }));
  }

  async exportInstance(binding: string, name: string): Promise<DurableObjectSnapshot> {
    return this.room(binding, name).exportStagingSnapshot();
  }

  async importInstance(
    binding: string,
    name: string,
    snapshot: DurableObjectSnapshot,
  ): Promise<void> {
    assertStagingSlot(this.env);
    await this.room(binding, name).importStagingSnapshot(snapshot);
  }

  private room(binding: string, name: string) {
    if (binding !== BINDING) throw new Error(`Unknown Durable Object binding ${binding}`);
    return this.env.MC_ROOM.getByName(name);
  }
}
