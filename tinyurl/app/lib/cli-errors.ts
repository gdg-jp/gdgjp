import type { FeatureFailure } from "~/features/shared/errors";

const STATUS_BY_CODE: Record<FeatureFailure["code"], number> = {
  invalid_input: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};

export function featureFailureResponse(failure: FeatureFailure): Response {
  return Response.json({ error: failure.error }, { status: STATUS_BY_CODE[failure.code] });
}

export function invalidRequestResponse(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}
