import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InviteeShareFailuresAlert } from "./InviteeShareFailuresAlert";

describe("InviteeShareFailuresAlert", () => {
  it("failures が空のときは何も描画しない", () => {
    expect(renderToStaticMarkup(<InviteeShareFailuresAlert failures={[]} />)).toBe("");
  });

  it("表示名・メールアドレス・失敗した生成ファイル一覧を表示する", () => {
    const html = renderToStaticMarkup(
      <InviteeShareFailuresAlert
        failures={[
          {
            emailNormalized: "bad@example.com",
            email: "Bad@example.com",
            displayName: "Bad User",
            artifacts: [
              {
                artifactId: "art-1",
                kind: "recording",
                title: "定例会議 録画",
                httpStatus: 400,
                apiStatus: "invalidSharingRequest",
              },
              {
                artifactId: "art-2",
                kind: "notes",
                title: "定例会議 メモ",
                httpStatus: 400,
                apiStatus: "invalidSharingRequest",
              },
            ],
          },
          {
            emailNormalized: "noname@example.com",
            email: "noname@example.com",
            displayName: null,
            artifacts: [
              {
                artifactId: "art-1",
                kind: "recording",
                title: "定例会議 録画",
                httpStatus: 400,
                apiStatus: "invalidSharingRequest",
              },
            ],
          },
        ]}
      />,
    );

    expect(html).toContain(
      "次の招待者には生成ファイルを Drive で共有できませんでした。アドレスを確認し、正しいアドレスに直すか招待者から外してください。招待者を保存すると共有をやり直します。",
    );
    expect(html).toContain("Bad User（Bad@example.com）");
    expect(html).toContain("noname@example.com");
    expect(html).toContain("録画");
    expect(html).toContain("定例会議 録画");
    expect(html).toContain("文字起こし・Gemini メモ");
    expect(html).toContain("定例会議 メモ");
  });
});
