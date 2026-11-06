import { describe, expect, it } from "vitest";
import { DRAFT_KINDS } from "~/features/drafts/draft-kinds";
import { SCHEDULE_KINDS } from "~/features/schedule/kinds";
import { outputSchemas, playbookFile, skillReads, skills } from "./guides.server";
import { PLAYBOOK_VERSION, playbook, provisionalConstants, runChecks } from "./playbook";

describe("bundled playbook", () => {
  it("has rules and constants", () => {
    expect(playbook.rules.length).toBeGreaterThan(20);
    expect(playbook.constants.channelCatalog.length).toBeGreaterThan(5);
    expect(typeof PLAYBOOK_VERSION).toBe("string");
  });

  it("only scopes rules to known draft kinds and plan", () => {
    // A rule scoped to a kind the app does not know would silently never run.
    const known = new Set(["plan", ...DRAFT_KINDS.map((k) => `draft.${k}`)]);
    for (const rule of playbook.rules)
      for (const scope of rule.scope) expect(known, rule.id).toContain(scope);
  });

  it("runs every mechanical rule (no unevaluated for a missing check)", () => {
    const report = runChecks({ kind: "plan", draft: { scheduleItems: [] }, brief: null });
    for (const result of report.results) expect(result.detail).not.toMatch(/検査 .* が無い/);
  });

  it("bundles every pr Skill with an output schema and resolvable reads", () => {
    for (const skill of [
      "pr-copy",
      "pr-x-post",
      "pr-connpass-page",
      "pr-connpass-mail",
      "pr-plan",
    ]) {
      expect(skills[skill], skill).toBeTruthy();
      expect(outputSchemas[skill], skill).toBeTruthy();
      for (const path of skillReads(skill))
        expect(playbookFile(path), `${skill} reads ${path}`).toBeTruthy();
    }
  });

  it("lists provisional constants", () => {
    expect(provisionalConstants()).toContain("x.foldThreshold");
  });

  it("keeps schedule kinds the plan Skill may emit known to the app", () => {
    expect(SCHEDULE_KINDS).toContain("staff_reminder");
  });
});
