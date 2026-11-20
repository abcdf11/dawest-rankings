import snapshot from "../data/seed.json";
import type {
  Ladder,
  MatchType,
  Player,
  PlayerDetail,
  Simulation,
} from "../types/rankings";
import { simulateLocal } from "./rating";
export const officialMode = import.meta.env.VITE_DATA_MODE === "official";
const base = (import.meta.env.VITE_API_URL ?? "/api/v1").replace(/\/$/, "");
export const demo = snapshot as unknown as Ladder & {
  details: Record<string, Pick<PlayerDetail, "history" | "matches">>;
};
export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...options,
    signal: AbortSignal.timeout(7000),
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.detail ??
        body?.non_field_errors?.[0] ??
        "The ranking service is unavailable.",
    );
  }
  return response.json() as Promise<T>;
}
export async function getLadder(): Promise<Ladder> {
  return officialMode ? request<Ladder>("/rankings/") : demo;
}
export async function getPlayer(
  player: Player,
  source: Ladder["source"],
): Promise<PlayerDetail> {
  if (source === "official")
    return request<PlayerDetail>(
      `/players/${encodeURIComponent(player.username)}/`,
    );
  return { ...player, ...demo.details[player.username] };
}
export async function simulate(
  players: Player[],
  a: number,
  b: number,
  scoreA: number,
  scoreB: number,
  type: MatchType,
  source: Ladder["source"],
): Promise<Simulation> {
  if (source === "demo")
    return simulateLocal(players, a, b, scoreA, scoreB, type);
  return request<Simulation>("/simulate/", {
    method: "POST",
    body: JSON.stringify({
      player_a_id: a,
      player_b_id: b,
      score_a: scoreA,
      score_b: scoreB,
      match_type: type,
    }),
  });
}
