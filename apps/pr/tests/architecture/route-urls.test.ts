import { describe, expect, it } from "vitest";
import routes from "../../app/routes";

type Entry = { path?: string; index?: boolean; children?: Entry[] };
// A pathless layout (the signed-in shell) adds no URL of its own.
const paths = (entries: Entry[]): string[] =>
  entries.flatMap((e) => [
    ...(e.index ? ["/"] : e.path ? [`/${e.path}`] : []),
    ...paths(e.children ?? []),
  ]);

describe("public URLs", () => {
  it("are exactly these (later stages add theirs here on purpose)", () => {
    expect(paths(routes as Entry[]).sort()).toMatchSnapshot();
  });
});
