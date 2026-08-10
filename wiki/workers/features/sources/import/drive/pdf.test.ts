import { describe, expect, it } from "vitest";
import { InvalidPdfExportError, spreadsheetSheetPdfUrl, validatedPdfBody } from "./pdf";

const encoder = new TextEncoder();

describe("validatedPdfBody", () => {
  it("accepts a PDF response", async () => {
    const body = await validatedPdfBody(
      new Response(encoder.encode("%PDF-1.7\n"), {
        headers: { "content-type": "application/pdf" },
      }),
    );
    expect(new TextDecoder().decode(body)).toBe("%PDF-1.7\n");
  });

  it("rejects HTML and invalid magic bytes", async () => {
    await expect(
      validatedPdfBody(
        new Response("<html>login</html>", { headers: { "content-type": "text/html" } }),
      ),
    ).rejects.toBeInstanceOf(InvalidPdfExportError);
    await expect(
      validatedPdfBody(new Response("hello", { headers: { "content-type": "application/pdf" } })),
    ).rejects.toThrow("%PDF-");
  });

  it("rejects content above the limit", async () => {
    await expect(
      validatedPdfBody(
        new Response(encoder.encode("%PDF-123"), {
          headers: { "content-type": "application/pdf", "content-length": "8" },
        }),
        7,
      ),
    ).rejects.toThrow("exceeds");
  });

  it("keeps HTTP failures distinct from skippable semantic validation", async () => {
    const error = await validatedPdfBody(new Response("busy", { status: 503 })).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(InvalidPdfExportError);
    expect((error as Error).message).toContain("(503)");
  });
});

it("constructs a single-sheet export URL", () => {
  const url = new URL(spreadsheetSheetPdfUrl("file/id", "123"));
  expect(url.pathname).toContain("file%2Fid");
  expect(url.searchParams.get("gid")).toBe("123");
  expect(url.searchParams.get("format")).toBe("pdf");
});
