import { test, expect } from "@playwright/test";
import { factionFixture, fixtureApi } from "./fixtures";
import teams from "../../frontend/src/data/teams.json";

const faction = factionFixture();
const linked = { ...faction, is_verified: true, roblox_faction: { faction_id: "verified123", name: "Blackwater Gang", linked_at: "2026-11-25T01:00:00Z" } };

test.beforeEach(async ({ page }) => {
  await fixtureApi(page);
  await page.addInitScript(() => sessionStorage.setItem("dawest:intro-seen:v1", "1"));
});

test("only linked factions show verification in the directory and public profile", async ({ page }, info) => {
  const otherName = teams.teams.find((team) => team.username !== linked.username)!.username;
  const other = { ...factionFixture(otherName), is_verified: false, roblox_faction: null };
  await page.route("**/api/v1/factions/", (route) => route.fulfill({ json: { factions: [linked, other] } }));
  await page.route("**/api/v1/factions/blackwater/", (route) => route.fulfill({ json: linked }));
  await page.goto("/factions");
  const verifiedCard = page.locator('.faction-card[href="/factions/blackwater"]');
  await expect(verifiedCard.getByRole("img", { name: "Verified faction", exact: true })).toBeVisible();
  await expect(page.locator(`.faction-card[href="/factions/${other.username}"]`).getByRole("img", { name: "Verified faction", exact: true })).toHaveCount(0);
  await verifiedCard.click();
  await expect(page.getByRole("heading", { name: "Blackwater", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Verified faction", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".faction-identity").screenshot({ path: `artifacts/verified-faction-${info.project.name}.png` });
});

test("unlinked faction profiles have no verification badge", async ({ page }) => {
  await page.route("**/api/v1/factions/blackwater/", (route) => route.fulfill({ json: { ...faction, is_verified: false, roblox_faction: null } }));
  await page.goto("/factions/blackwater");
  await expect(page.getByRole("heading", { name: "Blackwater", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Verified faction", exact: true })).toHaveCount(0);
});

test("unlinking in the leader dashboard removes verification", async ({ page }) => {
  let isLinked = true;
  const current = () => ({ ...linked, is_verified: isLinked, roblox_faction: isLinked ? linked.roblox_faction : null });
  const leader = faction.leader;
  await page.route("**/api/v1/auth/session/", (route) => route.fulfill({ json: {
    authenticated: true, csrf_token: "test-csrf",
    user: { id: leader.id, username: leader.username, is_developer: false, player: { ...leader, is_active: true } },
  } }));
  await page.route("**/api/v1/factions/mine/", (route) => route.fulfill({ json: { owned: [current()], membership: current(), requests: [] } }));
  await page.route("**/api/v1/factions/blackwater/manage/", (route) => route.fulfill({ json: { faction: current(), requests: [], recent_requests: [] } }));
  await page.route("**/api/v1/factions/blackwater/roblox-link/", (route) => {
    isLinked = false;
    return route.fulfill({ json: { roblox_faction: null } });
  });
  await page.goto("/factions/blackwater/manage");
  await expect(page.getByRole("img", { name: "Verified faction", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Unlink", exact: true }).click();
  await expect(page.getByRole("img", { name: "Verified faction", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Get link code", exact: true })).toBeVisible();
});

test("faction podium and rankings rows show badges only for linked teams", async ({ page }) => {
  await page.route("**/api/v1/teams/rankings/", (route) => route.fulfill({ json: {
    ...teams, source: "official", realtime_enabled: false,
    teams: teams.teams.map((team, index) => ({ ...team, is_verified: index === 0 })),
  } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Team rankings", exact: true }).click();
  await expect(page.locator(".podium-card").first().getByRole("img", { name: "Verified faction", exact: true })).toBeVisible();
  await expect(page.locator(".podium-card").nth(1).getByRole("img", { name: "Verified faction", exact: true })).toHaveCount(0);
  await expect(page.locator("tbody tr").first().getByRole("img", { name: "Verified faction", exact: true })).toBeVisible();
  await expect(page.locator("tbody tr").nth(1).getByRole("img", { name: "Verified faction", exact: true })).toHaveCount(0);
});
