import { WorkerEntrypoint } from "cloudflare:workers";
import type { ConnpassPrService } from "@gdgjp/gdg-lib";
import { createRequestHandler } from "react-router";
import type { JobQueueMessage } from "../app/features/jobs/job-types";
import {
  prCheckGroup,
  prCreateSubEvent,
  prGetJob,
  prGetStats,
  prListParticipants,
  prPublishEvent,
  prSendMessage,
  prUpdateEvent,
  prUploadImage,
  prUpsertSurvey,
} from "../app/features/jobs/pr-service.server";
import {
  LISTING_METHODS,
  LISTING_PLATFORMS,
  validateListing,
} from "../app/features/listings/listing";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

type In<K extends keyof ConnpassPrService> = Parameters<ConnpassPrService[K]>[0];

/**
 * pr.gdgs.jp's service binding (`entrypoint = "PrService"`). Each call authorizes its actor with
 * the same group rules as the Bearer API and writes through the same jobs.
 */
export class PrService extends WorkerEntrypoint<Env> implements ConnpassPrService {
  checkGroup(input: In<"checkGroup">) {
    return prCheckGroup(this.env, input);
  }
  updateEvent(input: In<"updateEvent">) {
    return prUpdateEvent(this.env, this.ctx, input);
  }
  publishEvent(input: In<"publishEvent">) {
    return prPublishEvent(this.env, this.ctx, input);
  }
  uploadImage(input: In<"uploadImage">) {
    return prUploadImage(this.env, this.ctx, input);
  }
  upsertSurvey(input: In<"upsertSurvey">) {
    return prUpsertSurvey(this.env, this.ctx, input);
  }
  sendMessage(input: In<"sendMessage">) {
    return prSendMessage(this.env, this.ctx, input);
  }
  async sendGroupMessage(_input: In<"sendGroupMessage">) {
    // No connpass job sends to a group's members yet (send_event_message reaches one event).
    return { ok: false as const, code: "not_supported" };
  }
  createSubEvent(input: In<"createSubEvent">) {
    return prCreateSubEvent(this.env, this.ctx, input);
  }
  /** Validated, then `not_supported`: no platform's method is chosen yet (Stage 05 pre-checks). */
  async createListing(input: In<"createListing">) {
    if (!(LISTING_PLATFORMS as readonly string[]).includes(input.platform))
      return { ok: false as const, code: "invalid_platform" };
    const valid = validateListing(input.listing);
    if (!valid.ok) return { ok: false as const, code: valid.error };
    return {
      ok: false as const,
      code: "not_supported",
      message: `${input.platform}: ${LISTING_METHODS[input.platform]}`,
    };
  }
  getJob(input: In<"getJob">) {
    return prGetJob(this.env, input);
  }
  getStats(input: In<"getStats">) {
    return prGetStats(this.env, input);
  }
  listParticipants(input: In<"listParticipants">) {
    return prListParticipants(this.env, input);
  }
}

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
  async queue(batch, env, ctx) {
    const { processJobMessage } = await import("../app/features/jobs/job-runner.server");
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
