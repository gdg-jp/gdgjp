import type {
  DomainJobFailure,
  DomainJobFailureCode,
} from "~/features/domains/domain-job.service.server";
import { cliError } from "./cli-http.server";

const STATUS_BY_CODE: Record<DomainJobFailureCode, number> = {
  invalid_input: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  queue_unavailable: 503,
};

export function domainJobErrorResponse(failure: DomainJobFailure): Response {
  return cliError(failure.error, STATUS_BY_CODE[failure.code]);
}
