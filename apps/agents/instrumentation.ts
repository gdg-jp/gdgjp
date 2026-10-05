import { registerOTel } from "@vercel/otel";

import { getLangfuseSpanProcessor } from "./features/telemetry/langfuse";

export function register(): void {
  const langfuseSpanProcessor = getLangfuseSpanProcessor();
  if (!langfuseSpanProcessor) return;
  registerOTel({
    serviceName: "gdgjp-agents",
    spanProcessors: [langfuseSpanProcessor],
  });
}
