import type {
  DomainJobFailure,
  DomainJobFailureCode,
} from "~/features/domains/domain-job.service.server";
import type { FeatureFailure } from "~/features/shared/errors";
import { cliError } from "./cli-http.server";

const FEATURE_FAILURE_STATUS: Record<FeatureFailure["code"], number> = {
  invalid_input: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};

/** Shared mapper for any stage's `FeatureFailure` results — the message is passed through as-is. */
export function featureFailureResponse(failure: FeatureFailure): Response {
  return cliError(failure.error, FEATURE_FAILURE_STATUS[failure.code]);
}

const DOMAIN_JOB_FAILURE_STATUS: Record<DomainJobFailureCode, number> = {
  ...FEATURE_FAILURE_STATUS,
  queue_unavailable: 503,
};

export function domainJobErrorResponse(failure: DomainJobFailure): Response {
  return cliError(failure.error, DOMAIN_JOB_FAILURE_STATUS[failure.code]);
}
