import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { DEFAULT_SPACE_SLUG, spacePath } from "~/features/spaces/shared";

/** v1 `/wiki/*` and `/sources` URLs → the same screen in the default space (301). */
export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return redirect(spacePath(DEFAULT_SPACE_SLUG, url.pathname) + url.search, 301);
}

export function action({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  // 308 keeps the method and body for stale forms posting to v1 URLs.
  return redirect(spacePath(DEFAULT_SPACE_SLUG, url.pathname) + url.search, 308);
}

export default function LegacyRedirect() {
  return null;
}
