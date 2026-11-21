import type { Page } from "@playwright/test";
import snapshot from "../../frontend/src/data/seed.json";
import teamSnapshot from "../../frontend/src/data/teams.json";
import type {
  Player,
  Team,
  MatchType,
} from "../../frontend/src/types/rankings";
import { simulateLocal } from "../../frontend/src/lib/rating";
const players = snapshot.players as Player[];
const teams = teamSnapshot.teams as unknown as Team[];
export async function fixtureApi(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session/"))
      return route.fulfill({
        json: { authenticated: false, user: null, csrf_token: "test-csrf" },
      });
    if (path.endsWith("/teams/rankings/"))
      return route.fulfill({
        json: { ...teamSnapshot, source: "official", realtime_enabled: false },
      });
    if (path.endsWith("/rankings/"))
      return route.fulfill({
        json: { ...snapshot, source: "official", realtime_enabled: false },
      });
    if (path.endsWith("/simulate/")) {
      const body = route.request().postDataJSON();
      const team = path.includes("/teams/");
      return route.fulfill({
        json: simulateLocal(
          team ? teams : players,
          team ? body.team_a_id : body.player_a_id,
          team ? body.team_b_id : body.player_b_id,
          body.score_a,
          body.score_b,
          body.match_type as MatchType,
        ),
      });
    }
    const playerName = path.match(/\/players\/([^/]+)\/$/)?.[1];
    if (playerName) {
      const player = players.find((p) => p.username === playerName);
      if (!player)
        return route.fulfill({ status: 404, json: { detail: "Not found." } });
      const details = (snapshot.details as Record<string, unknown>)[
        playerName
      ] as object;
      return route.fulfill({
        json: { ...player, ...details, registered_at: snapshot.updated_at },
      });
    }
    const teamName = path.match(/\/teams\/([^/]+)\/$/)?.[1];
    if (teamName) {
      const team = teams.find((t) => t.username === teamName);
      const details = (teamSnapshot.details as Record<string, unknown>)[
        teamName
      ] as object;
      return route.fulfill({ json: { ...team, ...details } });
    }
    return route.continue();
  });
}
