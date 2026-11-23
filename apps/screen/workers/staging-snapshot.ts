import { WorkerEntrypoint } from "cloudflare:workers";
import {
  type DurableObjectSnapshot,
  type StagingSnapshotInstance,
  type StagingSnapshotService,
  assertStagingSlot,
} from "@gdgjp/gdg-lib/staging-snapshot";

const BINDING = "STAGE";

export class StagingSnapshot extends WorkerEntrypoint<Env> implements StagingSnapshotService {
  async instances(): Promise<StagingSnapshotInstance[]> {
    const { results } = await this.env.DB.prepare("SELECT id FROM stage ORDER BY id").all<{
      id: string;
    }>();
    return results.map(({ id }) => ({ binding: BINDING, name: id }));
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
    return this.env.STAGE.getByName(name);
  }
}
