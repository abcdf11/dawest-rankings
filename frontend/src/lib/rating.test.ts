import { describe, expect, it } from "vitest";
import { tierForRating } from "./rating";

describe("rating tiers", () => {
  it("handles tier boundaries", () => {
    expect([1299.99, 1300, 1500, 1700, 1900].map(tierForRating)).toEqual([
      "ROOKIE",
      "DEPUTY",
      "GUNSLINGER",
      "OUTLAW",
      "LEGEND",
    ]);
  });
});
