import { describe, expect, it } from "vitest";
import { InvalidIngestionTransitionError, transitionIngestion } from "./ingestion-state-machine";

describe("transitionIngestion", () => {
  it("moves through a URL selection checkpoint", () => {
    expect(
      transitionIngestion(
        { status: "processing", phase: "initial" },
        { type: "request_url_selection" },
      ),
    ).toEqual({ status: "awaiting_url_selection", phase: "url_selection" });
    expect(
      transitionIngestion(
        { status: "awaiting_url_selection", phase: "url_selection" },
        { type: "submit_url_selection" },
      ),
    ).toEqual({ status: "processing", phase: "post_url_selection" });
  });

  it("allows regeneration only from a completed session", () => {
    expect(
      transitionIngestion(
        { status: "done", phase: "completed" },
        { type: "start_phase", phase: "regeneration" },
      ),
    ).toEqual({ status: "processing", phase: "regeneration" });
    expect(() =>
      transitionIngestion(
        { status: "awaiting_clarification", phase: "clarification" },
        { type: "start_phase", phase: "regeneration" },
      ),
    ).toThrow(InvalidIngestionTransitionError);
  });
});
