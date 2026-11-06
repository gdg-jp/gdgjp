import constantsJson from "@skills/pr-playbook/constants.json";
import rulesJson from "@skills/pr-playbook/rules.json";
// The bundled Playbook (skills/pr-playbook from the gdg-jp/skills submodule). Rules and
// constants are small and shared by server and client; guides and Skills stay server-side.
import {
  type CheckReport,
  type DraftKind,
  type Playbook,
  type Rule,
  runChecks as runPlaybookChecks,
} from "@skills/pr-playbook/scripts/checks/index.mjs";

export type PlaybookConstants = typeof constantsJson;
export type { CheckReport, DraftKind, Rule };

export const PLAYBOOK_VERSION: string =
  typeof __PLAYBOOK_VERSION__ === "string" ? __PLAYBOOK_VERSION__ : "dev";

export const playbook: Playbook & { constants: PlaybookConstants } = {
  rules: rulesJson.rules as Rule[],
  constants: constantsJson,
  version: PLAYBOOK_VERSION,
};

export const constants: PlaybookConstants = constantsJson;

export function channelLabel(channel: string): string {
  return (constants.channelLabels as Record<string, string>)[channel] ?? channel;
}

/** Paths of every provisional constant (shown as a warning: not measured values). */
export function provisionalConstants(): string[] {
  const out: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "provisional" && value === true) out.push(path);
      else if (key.startsWith("provisional_") && value === true)
        out.push(`${path}.${key.slice(12)}`);
      else walk(value, path ? `${path}.${key}` : key);
    }
  };
  walk(constantsJson, "");
  return out;
}

export function scopeForKind(kind: string): string {
  return kind === "plan" ? "plan" : `draft.${kind}`;
}

/** Run the Playbook checks. The Worker cannot run yomiyasu; the runner's result is passed in. */
export function runChecks(input: {
  kind: DraftKind;
  draft: unknown;
  brief?: unknown;
  related?: unknown;
  yomiyasu?: { status: "pass" | "fail" | "unevaluated"; detail?: string } | null;
}): CheckReport {
  return runPlaybookChecks({ ...input, playbook });
}
