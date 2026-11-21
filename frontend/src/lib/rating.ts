import type { Tier } from "../types/rankings";
export const tierForRating = (r: number): Tier =>
  r >= 1900
    ? "LEGEND"
    : r >= 1700
      ? "OUTLAW"
      : r >= 1500
        ? "GUNSLINGER"
        : r >= 1300
          ? "DEPUTY"
          : "ROOKIE";
export const formatRating = (r: number) =>
  Math.round(r).toLocaleString("en-US");
export const tierLabel = (tier: string) =>
  tier.charAt(0) + tier.slice(1).toLowerCase();
