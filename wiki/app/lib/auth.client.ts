import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Browser-side better-auth client.
 * Use for sign-in/sign-out actions in React components.
 * baseURL defaults to window.location.origin when not set.
 */
export const authClient = createAuthClient({
  plugins: [genericOAuthClient()],
});
