import { describe, expect, it } from "vitest";
import { constants } from "~/features/playbook/playbook";
import { surveyFromPlan } from "./survey";

const plan = (channels: string[]) => ({
  channelMix: channels.map((channel) => ({
    channel,
    label: null,
    adopt: true,
    reason: "",
    weight: null,
  })),
  surveyQuestions: [
    { title: "年齢", answerType: "radio", required: true, options: ["10代", "20代"] },
    { title: "イベントを知った場所", answerType: "radio", required: false, options: ["X"] },
  ],
});

describe("surveyFromPlan", () => {
  it("offers exactly the labels of the adopted channels as where people heard of it", () => {
    const result = surveyFromPlan(plan(["x_organic", "gdg_discord", "x_organic"]), constants);
    if (!result.ok) throw new Error(result.error);
    expect(result.questions[1]).toEqual({
      title: "イベントを知った場所",
      answerType: "checkbox",
      required: true,
      options: [constants.channelLabels.x_organic, constants.channelLabels.gdg_discord, "その他"],
    });
    expect(result.questions.every((q) => q.required)).toBe(true);
  });
  it("refuses a channel the Playbook has no label for", () => {
    expect(surveyFromPlan(plan(["x_organic", "tiktok"]), constants)).toMatchObject({ ok: false });
  });
});
