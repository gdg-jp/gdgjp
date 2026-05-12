import { describe, expect, it } from "vitest";
import { toEvent } from "./db";

describe("toEvent", () => {
  it("maps snake_case columns to camelCase", () => {
    const event = toEvent({
      id: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      title: "Sync",
      description: "weekly",
      owner_user_id: "user_abc",
      created_at: 1700000000,
      updated_at: 1700001000,
      deleted_at: null,
    });
    expect(event).toEqual({
      id: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      title: "Sync",
      description: "weekly",
      ownerUserId: "user_abc",
      createdAt: 1700000000,
      updatedAt: 1700001000,
      deletedAt: null,
    });
  });

  it("passes through nulls", () => {
    const event = toEvent({
      id: "evt_x",
      title: "t",
      description: null,
      owner_user_id: null,
      created_at: 1,
      updated_at: 1,
      deleted_at: null,
    });
    expect(event.description).toBeNull();
    expect(event.ownerUserId).toBeNull();
  });
});
