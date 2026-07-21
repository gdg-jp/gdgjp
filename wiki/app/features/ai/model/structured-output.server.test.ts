import { NoObjectGeneratedError, generateText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateValidatedObject } from "./structured-output.server";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: vi.fn() };
});

const mockedGenerateText = vi.mocked(generateText);

function schemaMismatch(text: string) {
  const validationError = z.object({ value: z.number() }).safeParse({ value: "invalid" }).error;
  return new NoObjectGeneratedError({
    message: "No object generated: response did not match schema.",
    cause: new Error("validation failed", { cause: validationError }),
    text,
    response: {} as never,
    usage: {} as never,
    finishReason: "stop",
  });
}

describe("generateValidatedObject", () => {
  beforeEach(() => {
    mockedGenerateText.mockReset();
  });

  it("repairs a schema-invalid response exactly once", async () => {
    const first = {
      get output() {
        throw schemaMismatch('{"value":"wrong type"}');
      },
    };
    mockedGenerateText
      .mockResolvedValueOnce(first as never)
      .mockResolvedValueOnce({ output: { value: 42 } } as never);

    const result = await generateValidatedObject({
      model: {} as never,
      schema: z.object({ value: z.number() }),
      schemaName: "Fixture",
      messages: [{ role: "user", content: "Return a fixture." }],
      maxRetries: 0,
    });

    expect(result).toEqual({ value: 42 });
    expect(mockedGenerateText).toHaveBeenCalledTimes(2);
    const repairRequest = mockedGenerateText.mock.calls[1]?.[0];
    expect(repairRequest?.messages).toEqual(
      expect.arrayContaining([
        { role: "assistant", content: '{"value":"wrong type"}' },
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("スキーマに一致しませんでした"),
        }),
      ]),
    );
  });

  it("does not retry provider failures without a candidate response", async () => {
    mockedGenerateText.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(
      generateValidatedObject({
        model: {} as never,
        schema: z.object({ value: z.number() }),
        schemaName: "Fixture",
        messages: [{ role: "user", content: "Return a fixture." }],
      }),
    ).rejects.toThrow("provider unavailable");
    expect(mockedGenerateText).toHaveBeenCalledTimes(1);
  });

  it("stops after one failed repair", async () => {
    const invalidResult = (text: string) => ({
      get output() {
        throw schemaMismatch(text);
      },
    });
    mockedGenerateText
      .mockResolvedValueOnce(invalidResult('{"value":"first"}') as never)
      .mockResolvedValueOnce(invalidResult('{"value":"second"}') as never);

    await expect(
      generateValidatedObject({
        model: {} as never,
        schema: z.object({ value: z.number() }),
        schemaName: "Fixture",
        messages: [{ role: "user", content: "Return a fixture." }],
      }),
    ).rejects.toThrow(
      "Structured output repair failed for Fixture (finishReason=stop, validationPaths=value)",
    );
    expect(mockedGenerateText).toHaveBeenCalledTimes(2);
  });
});
