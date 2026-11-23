import { DurableObject } from "cloudflare:workers";
import { createApp } from "../app";
import type { Env } from "../env";
import { sweepOverdue } from "../features/inquiry/inquiry";

const SWEEP_MS = 30_000;

export class PendingSweeper extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
    return new Response(null, { status: 204 });
  }

  async alarm(): Promise<void> {
    const app = createApp(this.env);
    await sweepOverdue(app.inquiry);
    if ((await app.pending.countPending()) > 0)
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }
}
