import { WorkerEntrypoint } from "cloudflare:workers";
import {
  type DurableObjectSnapshot,
  type StagingSnapshotInstance,
  type StagingSnapshotService,
  assertStagingSlot,
} from "@gdgjp/gdg-lib/staging-snapshot";
import { collabRoomName } from "../app/features/editor/collab-room";

const COLLAB = "COLLAB_DO";
const SOURCE_IMPORT = "SOURCE_IMPORT_DO";

export class StagingSnapshot extends WorkerEntrypoint<Env> implements StagingSnapshotService {
  async instances(): Promise<StagingSnapshotInstance[]> {
    const pages = await this.env.DB.prepare(
      "SELECT space_id, slug FROM pages ORDER BY space_id, slug",
    ).all<{ space_id: string; slug: string }>();
    const sources = await this.env.DB.prepare("SELECT id FROM sources ORDER BY id").all<{
      id: string;
    }>();
    const rooms = new Set(
      pages.results.map(({ space_id, slug }) => collabRoomName(space_id, slug)),
    );
    return [
      ...[...rooms].map((name) => ({ binding: COLLAB, name })),
      ...sources.results.map(({ id }) => ({ binding: SOURCE_IMPORT, name: id })),
    ];
  }

  async exportInstance(binding: string, name: string): Promise<DurableObjectSnapshot> {
    return this.target(binding, name).exportStagingSnapshot();
  }

  async importInstance(
    binding: string,
    name: string,
    snapshot: DurableObjectSnapshot,
  ): Promise<void> {
    assertStagingSlot(this.env);
    await this.target(binding, name).importStagingSnapshot(snapshot);
  }

  private target(binding: string, name: string) {
    if (binding === COLLAB) return this.env.COLLAB_DO.getByName(name);
    if (binding === SOURCE_IMPORT) return this.env.SOURCE_IMPORT_DO.getByName(name);
    throw new Error(`Unknown Durable Object binding ${binding}`);
  }
}
