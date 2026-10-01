import type { Route } from "./+types/e.$id.s.$sheetId.design";
import * as design from "./e.$id.design";

export { action, meta, default } from "./e.$id.design";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  return design.loadSheetDesign(context.cloudflare.env, request, params.id, params.sheetId);
}
