import { AsyncLocalStorage } from "node:async_hooks";
import { WorkerEntrypoint } from "cloudflare:workers";
import type {
  ListChapterMembersInput,
  ListRegisteredEmailsInput,
  ListUserAvatarsByEmailsInput,
  MeetDirectoryService as MeetDirectoryServiceContract,
} from "@gdgjp/gdg-lib";
import { createRequestHandler } from "react-router";
import { warmAuth } from "~/features/auth/auth.server";
import { seedBetterAuthAsyncLocalStorage } from "~/features/auth/seed-better-auth-als.server";
import { reconcileSsoCookie } from "~/features/auth/sso-cookie.server";
import {
  listMeetChapterMembers,
  listMeetRegisteredEmails,
  listMeetUserAvatarsByEmails,
} from "~/features/memberships/meet-directory.server";
import { seedClients } from "~/features/oauth/seed-clients.server";

// Keep a static node:async_hooks import in the Worker entry so the isolate
// loads AsyncLocalStorage outside any request I/O context.
void AsyncLocalStorage;

seedBetterAuthAsyncLocalStorage();

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

let e2eSeedPromise: Promise<void> | undefined;

function seedE2eClients(env: Env): Promise<void> {
  if (!e2eSeedPromise) {
    e2eSeedPromise = seedClients(env)
      .then(() => undefined)
      .catch((error) => {
        e2eSeedPromise = undefined;
        throw error;
      });
  }
  return e2eSeedPromise;
}

/** meet.gdgs.jp 向け service binding（`entrypoint = "MeetDirectoryService"`）の RPC エントリポイント。 */
export class MeetDirectoryService
  extends WorkerEntrypoint<Env>
  implements MeetDirectoryServiceContract
{
  listChapterMembers(input: ListChapterMembersInput) {
    return listMeetChapterMembers(this.env.DB, input);
  }

  listUserAvatarsByEmails(input: ListUserAvatarsByEmailsInput) {
    return listMeetUserAvatarsByEmails(this.env.DB, input);
  }

  listRegisteredEmails(input: ListRegisteredEmailsInput) {
    return listMeetRegisteredEmails(this.env.DB, input);
  }
}

export default {
  async fetch(request, env, ctx) {
    // Anchor betterAuth `$context` init to waitUntil so client abort cannot
    // poison the module-scoped init promise for the rest of this isolate.
    ctx.waitUntil(warmAuth(env));
    if (env.E2E_TEST_MODE === "true") await seedE2eClients(env);
    const response = await requestHandler(request, { cloudflare: { env, ctx } });
    // A failed hint update only costs relying parties a re-check; never fail
    // the IdP response itself.
    return reconcileSsoCookie(env, request, response).catch((error: unknown) => {
      console.warn("SSO cookie reconciliation failed", error);
      return response;
    });
  },
} satisfies ExportedHandler<Env>;
