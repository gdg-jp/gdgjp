import { describe, expect, it } from "vitest";
import { type Message, openQuestions, urlsIn } from "./message";

const msg = (id: number, author: Message["author"], questions: string[] = []): Message => ({
  id,
  campaignId: 1,
  author,
  userId: null,
  userName: null,
  body: "",
  attachments: [],
  actions: [],
  questions,
  meta: {},
  jobId: null,
  eventKey: null,
  createdAt: id,
});

describe("openQuestions", () => {
  it("is the assistant's last questions while nobody has answered", () => {
    expect(openQuestions([msg(1, "user"), msg(2, "assistant", ["目標は？"])])).toEqual({
      messageId: 2,
      questions: ["目標は？"],
    });
    expect(openQuestions([msg(2, "assistant", ["目標は？"]), msg(3, "user")])).toBeNull();
    expect(openQuestions([msg(2, "assistant")])).toBeNull();
    expect(openQuestions([])).toBeNull();
  });
});

describe("urlsIn", () => {
  it("finds URLs in Japanese text without the punctuation around them", () => {
    expect(
      urlsIn(
        "ページは https://gdg-kwansai.connpass.com/event/1/ です。資料（https://docs.google.com/document/d/abc/edit）も。https://gdg-kwansai.connpass.com/event/1/",
      ),
    ).toEqual([
      "https://gdg-kwansai.connpass.com/event/1/",
      "https://docs.google.com/document/d/abc/edit",
    ]);
  });
});
