/** The provider-specific schema repair implementation remains behind this
 * small worker-owned import point. */
export {
  generateValidatedObject,
  type StructuredOutputAttemptResult,
  type StructuredOutputStage,
  type StructuredOutputTelemetry,
} from "../../../../app/features/ai/model/structured-output.server";
