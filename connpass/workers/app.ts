import { createRequestHandler } from "react-router";
import { type JobQueueMessage, processJobMessage } from "../app/lib/job-runner.server";
import { CloudflareContext } from "./context";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, new CloudflareContext({ env, ctx }));
  },
  async queue(batch, env, ctx) {
    for (const message of batch.messages) {
      try {
        await processJobMessage(env, ctx, message.body as JobQueueMessage);
        message.ack();
      } catch (error) {
        console.error("connpass job failed", error);
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;
