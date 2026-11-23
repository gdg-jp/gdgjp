import { WorkerEntrypoint } from "cloudflare:workers";
import {
  type DurableObjectSnapshot,
  type StagingSnapshotInstance,
  type StagingSnapshotService,
  assertStagingSlot,
} from "@gdgjp/gdg-lib/staging-snapshot";

const BINDING = "OST_BOARD";

export class StagingSnapshot extends WorkerEntrypoint<Env> implements StagingSnapshotService {
  async instances(): Promise<StagingSnapshotInstance[]> {
    const { results } = await this.env.DB.prepare("SELECT slug FROM events ORDER BY slug").all<{
      slug: string;
    }>();
    return results.map(({ slug }) => ({ binding: BINDING, name: slug }));
  }

  async exportInstance(binding: string, name: string): Promise<DurableObjectSnapshot> {
    return this.board(binding, name).exportStagingSnapshot();
  }

  async importInstance(
    binding: string,
    name: string,
    snapshot: DurableObjectSnapshot,
  ): Promise<void> {
    assertStagingSlot(this.env);
    await this.board(binding, name).importStagingSnapshot(snapshot);
  }

  private board(binding: string, name: string) {
    if (binding !== BINDING) throw new Error(`Unknown Durable Object binding ${binding}`);
    return this.env.OST_BOARD.getByName(name);
  }
}
