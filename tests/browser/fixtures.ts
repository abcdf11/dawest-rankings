import type { Page } from "@playwright/test";
import snapshot from "../../frontend/src/data/seed.json";
import teamSnapshot from "../../frontend/src/data/teams.json";
import type { Player, Team } from "../../frontend/src/types/rankings";
const players = snapshot.players as Player[];
const teams = teamSnapshot.teams as unknown as Team[];
export function factionFixture(username = "blackwater") {
  const team = teams.find((team) => team.username === username)!;
  const details = (teamSnapshot.details as Record<string, object>)[username];
  const members = team.roster.map((member, index) => ({
    ...member,
    is_leader: index === 0,
    is_captain: index === 0,
    joined_at: teamSnapshot.updated_at,
  }));
  return {
    ...team,
    ...details,
    banner_url: "",
    description: "North American ranked faction.",
    registered_at: teamSnapshot.updated_at,
    members,
    leader: members[0],
    member_count: members.length,
    capacity: 10,
    profile_url: `/factions/${username}`,
  };
}
export async function fixtureApi(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session/"))
      return route.fulfill({
        json: { authenticated: false, user: null, csrf_token: "test-csrf" },
      });
    if (path === "/api/v1/factions/")
      return route.fulfill({
        json: {
          factions: teams.map((team) => ({
            ...team,
            banner_url: "",
            member_count: team.roster.length,
            capacity: 10,
            profile_url: `/factions/${team.username}`,
          })),
        },
      });
    const factionName = path.match(/^\/api\/v1\/factions\/([^/]+)\/$/)?.[1];
    if (factionName && teams.some((team) => team.username === factionName))
      return route.fulfill({ json: factionFixture(factionName) });
    if (path.endsWith("/teams/rankings/"))
      return route.fulfill({
        json: { ...teamSnapshot, source: "official", realtime_enabled: false },
      });
    if (path.endsWith("/rankings/"))
      return route.fulfill({
        json: { ...snapshot, source: "official", realtime_enabled: false },
      });
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
