import type {
  MatchType,
  RankedCompetitor,
  Simulation,
  Tier,
} from "../types/rankings";
export const WEIGHTS: Record<MatchType, number> = {
  RANKED_1V1: 1,
  RANKED_TEAM: 1,
  SHOWMATCH: 1.2,
  TOURNAMENT: 1.5,
  QUALIFIER: 1.25,
};
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
// Banker's rounding mirrors Python round at decimal ties.
function round2(n: number) {
  const scaled = n * 100,
    floor = Math.floor(scaled),
    fraction = scaled - floor;
  return (
    (Math.abs(fraction - 0.5) < 1e-10
      ? floor % 2 === 0
        ? floor
        : floor + 1
      : Math.round(scaled)) / 100
  );
}
export function simulateLocal(
  players: RankedCompetitor[],
  aId: number,
  bId: number,
  scoreA: number,
  scoreB: number,
  type: MatchType,
): Simulation {
  const a = players.find((p) => p.id === aId),
    b = players.find((p) => p.id === bId);
  if (!a || !b || aId === bId) throw new Error("Choose two different players.");
  if (
    ![scoreA, scoreB].every((s) => Number.isInteger(s) && s >= 0 && s <= 100) ||
    scoreA === scoreB
  )
    throw new Error("Enter different scores between 0 and 100.");
  if (!(type in WEIGHTS)) throw new Error("Unknown match type.");
  const expected =
    1 /
    (1 + 10 ** (Math.max(-4000, Math.min(4000, b.rating - a.rating)) / 400));
  const margin = 1 + 0.35 * Math.log1p(Math.abs(scoreA - scoreB));
  const delta = round2(
    Math.max(
      -a.rating,
      Math.min(
        b.rating,
        32 * WEIGHTS[type] * margin * ((scoreA > scoreB ? 1 : 0) - expected),
      ),
    ),
  );
  const ratingA = round2(a.rating + delta),
    ratingB = round2(b.rating - delta);
  const proposed = players
    .map((p) => ({
      ...p,
      rating: p.id === aId ? ratingA : p.id === bId ? ratingB : p.rating,
    }))
    .sort(
      (x, y) => y.rating - x.rating || x.username.localeCompare(y.username),
    );
  return {
    delta_a: delta,
    delta_b: -delta,
    rating_a: ratingA,
    rating_b: ratingB,
    expected_a: expected,
    margin_multiplier: margin,
    event_weight: WEIGHTS[type],
    players: [a, b].map((p, i) => ({
      id: p.id,
      username: p.username,
      before: p.rating,
      after: i === 0 ? ratingA : ratingB,
      delta: i === 0 ? delta : -delta,
      rank_before: p.rank,
      rank_after: proposed.findIndex((x) => x.id === p.id) + 1,
      tier: tierForRating(i === 0 ? ratingA : ratingB),
    })),
  };
}
export const formatRating = (r: number) =>
  Math.round(r).toLocaleString("en-US");
export const tierLabel = (tier: string) =>
  tier.charAt(0) + tier.slice(1).toLowerCase();
