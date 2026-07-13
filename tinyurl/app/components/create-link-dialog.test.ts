import { describe, expect, it } from "vitest";
import { campaignLinkDefaults } from "./create-link-dialog";

describe("campaignLinkDefaults", () => {
  it("replaces both generated fields when the campaign channel changes", () => {
    expect(
      campaignLinkDefaults({
        id: 2,
        campaignName: "DevFest",
        campaignCode: "df",
        defaultDestinationUrl: "https://example.com/devfest",
        channelName: "X",
        channelCode: "x",
      }),
    ).toEqual({
      destinationUrl: "https://example.com/devfest",
      slug: "dfx",
    });
  });

  it("clears generated fields when the selected channel has no defaults", () => {
    expect(
      campaignLinkDefaults({
        id: 3,
        campaignName: "Study Jam",
        channelName: "Email",
      }),
    ).toEqual({ destinationUrl: "", slug: "" });
  });
});
