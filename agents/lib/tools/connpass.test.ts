import { describe, expect, it, vi } from "vitest";
import { createConnpassTools } from "./connpass";

describe("createConnpassTools", () => {
  it("lists events through the connpass API", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ groupId: "gdg-tokyo", events: [] }, { status: 200 }),
    );
    const tools = createConnpassTools({
      accessToken: "tok",
      connpassApiUrl: "https://connpass.gdgs.jp",
      fetch: fetchMock,
    });
    const body = await tools.connpass_list_events.execute?.(
      { groupId: "gdg-tokyo" },
      { toolCallId: "1", messages: [] },
    );
    expect(fetchMock).toHaveBeenCalled();
    expect(body).toEqual({ groupId: "gdg-tokyo", events: [] });
  });

  it("returns API errors without throwing", async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: "forbidden" }, { status: 403 }));
    const tools = createConnpassTools({
      accessToken: "tok",
      connpassApiUrl: "https://connpass.gdgs.jp",
      fetch: fetchMock,
    });
    const body = await tools.connpass_create_event.execute?.(
      { groupId: "gdg-tokyo", title: "x" },
      { toolCallId: "1", messages: [] },
    );
    expect(body).toEqual({ error: "forbidden", status: 403 });
  });
});
