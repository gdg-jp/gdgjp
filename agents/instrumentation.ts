import { registerOTel } from "@vercel/otel";

import { getLangfuseSpanProcessor } from "./lib/langfuse";

export function register(): void {
  const langfuseSpanProcessor = getLangfuseSpanProcessor();
  if (!langfuseSpanProcessor) return;
  registerOTel({
    serviceName: "gdgjp-agents",
    spanProcessors: [langfuseSpanProcessor],
  });
}
