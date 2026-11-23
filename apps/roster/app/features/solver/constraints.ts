import {
  type Assignments,
  type SolverApplication,
  type SolverInput,
  type SolverSlot,
  assignmentKey,
  demandKey,
  getAvailability,
} from "./types";

export function hardViolations(
  input: SolverInput,
  app: SolverApplication,
  slot: SolverSlot,
  trackId: string,
  roleId: string,
  assignments: Assignments,
): string[] {
  const warnings: string[] = [];

  if (assignments.has(assignmentKey(app.id, slot.id))) {
    warnings.push("既にこの時間枠に割り当てられています（1人2箇所は不可）");
  }

  if (!app.skills[roleId]) {
    warnings.push("この役割を担当できません（スキル登録がありません）");
  }

  if (getAvailability(app, slot.id) === "x") {
    warnings.push("この時間枠は稼働不可（×）です");
  }

  if (app.withdrawn) {
    warnings.push("辞退済みです");
  }

  const demand = input.demands.get(demandKey(slot.id, trackId, roleId));
  if (!demand || demand.ideal === 0) {
    warnings.push("この時間枠・トラック・役割の組み合わせには需要がありません");
  }

  return warnings;
}
