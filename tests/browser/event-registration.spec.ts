import { test, expect, type Page } from "@playwright/test";
import { factionFixture, fixtureApi } from "./fixtures";
import type { CompetitionEvent, EventEntries, EventTeam } from "../../frontend/src/types/events";

const event: CompetitionEvent = {
  id: "44444444-4444-4444-4444-444444444444", title: "Frontier Faction Cup",
  description: "Faction matches for the December cup.", format: "FACTION", region: "GLOBAL",
  location: "Online", starts_at: "2026-12-10T10:00:00Z", ends_at: null, status: "UPCOMING",
  registration_url: "", url: "/events/44444444-4444-4444-4444-444444444444", updated_at: "2026-11-25T01:00:00Z",
};
const faction: EventTeam = { slug: "blackwater", name: "Blackwater", tag: "BLW", url: "/factions/blackwater", logo_url: "" };
const other: EventTeam = { slug: "frontier", name: "Frontier Guard", tag: "FTG", url: "/factions/frontier", logo_url: "" };

async function setup(page: Page, options: {
  role?: "leader" | "anonymous" | "member" | "restricted";
  closed?: boolean;
  registered?: boolean;
  multiple?: boolean;
} = {}) {
  await fixtureApi(page);
  await page.addInitScript(() => sessionStorage.setItem("dawest:intro-seen:v1", "1"));
  const role = options.role ?? "leader";
  const owned = role === "leader" || role === "restricted" ? options.multiple ? [faction, other] : [faction] : [];
  const state = { open: !options.closed, registered: new Set(options.registered ? [faction.slug] : []), posts: [] as string[] };
  const payload = (): EventEntries => ({
    registration_open: state.open,
    entries: [faction, other].filter((team) => state.registered.has(team.slug)),
    my_teams: owned.map((team) => ({ ...team, registered: state.registered.has(team.slug) })),
  });
  const profile = factionFixture();
  await page.route("**/api/v1/auth/session/", (route) => route.fulfill({ json: {
    authenticated: role !== "anonymous", csrf_token: "test-csrf",
    user: role === "anonymous" ? null : {
      id: 7, username: profile.leader.username, is_developer: false,
      player: { ...profile.leader, is_active: true, is_restricted: role === "restricted" },
    },
  } }));
  await page.route("**/api/v1/event-notifications/", (route) => route.fulfill({ json: { unread_count: 0, notifications: [] } }));
  await page.route("**/api/v1/factions/mine/", (route) => route.fulfill({ json: { owned: role === "leader" ? [profile] : [], membership: profile, requests: [] } }));
  await page.route("**/api/v1/factions/blackwater/manage/", (route) => route.fulfill({ json: { faction: profile, requests: [], recent_requests: [] } }));
  const current = () => ({ ...event, status: state.open ? "UPCOMING" : "LIVE", teams: payload().entries, team_count: state.registered.size });
  await page.route("**/api/v1/events/", (route) => route.fulfill({ json: { events: [
    current(), { ...event, id: "55555555-5555-5555-5555-555555555555", title: "Solo Cup", format: "SOLO", url: "/events/55555555-5555-5555-5555-555555555555" },
  ] } }));
  await page.route(`**/api/v1/events/${event.id}/`, (route) => route.fulfill({ json: { ...current(), matches: [] } }));
  await page.route(`**/api/v1/events/${event.id}/pickems/`, (route) => route.fulfill({ json: { matchups: [], leaderboard: [], me: null, can_pick: false, participants: 0 } }));
  await page.route(`**/api/v1/events/${event.id}/entries/`, (route) => {
    if (route.request().method() === "POST") {
      if (!state.open) return route.fulfill({ status: 409, json: { detail: "Registration is closed for this event." } });
      const slug = route.request().postDataJSON().team;
      state.posts.push(slug);
      state.registered.add(slug);
      return route.fulfill({ status: 201, json: payload() });
    }
    return route.fulfill({ json: payload() });
  });
  await page.route(`**/api/v1/events/${event.id}/entries/*/`, (route) => {
    state.registered.delete(new URL(route.request().url()).pathname.split("/").at(-2)!);
    return route.fulfill({ json: payload() });
  });
  return state;
}

test("leader finds registration from the faction dashboard, enters, reloads and withdraws", async ({ page }, info) => {
  const state = await setup(page);
  await page.goto("/factions/blackwater/manage");
  await page.getByRole("link", { name: "Find faction events", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Event format" })).toHaveValue("FACTION");
  await expect(page.locator(".event-card")).toHaveCount(1);
  await page.getByRole("link", { name: "Register faction", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${event.id}#faction-registration$`));
  const panel = page.getByRole("region", { name: "Faction registration", exact: true });
  await expect(panel.getByLabel("Choose your faction")).toHaveValue("blackwater");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: `artifacts/event-registration-${info.project.name}.png` });
  await panel.getByRole("button", { name: "Register faction", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Blackwater is registered for this event.");
  expect(state.posts).toEqual(["blackwater"]);
  await expect(page.getByRole("region", { name: "Registered teams", exact: true }).getByRole("listitem")).toHaveCount(1);
  await page.reload();
  await expect(panel.getByRole("list", { name: "Your registered factions" })).toContainText("Blackwater");
  await panel.getByRole("button", { name: "Withdraw Blackwater", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Blackwater has been withdrawn.");
  await expect(panel.getByLabel("Choose your faction")).toBeVisible();
  await expect(page.getByRole("region", { name: "Registered teams", exact: true })).toContainText("No teams registered yet.");
});

test("a leader with multiple factions registers the selected faction", async ({ page }) => {
  const state = await setup(page, { multiple: true });
  await page.goto(event.url);
  await page.getByLabel("Choose your faction").selectOption("frontier");
  await page.getByRole("button", { name: "Register faction", exact: true }).click();
  await expect(page.getByRole("list", { name: "Your registered factions" })).toContainText("Frontier Guard");
  expect(state.posts).toEqual(["frontier"]);
  await expect(page.getByLabel("Choose your faction")).toHaveValue("blackwater");
});

test("anonymous visitors can sign in and return to the registration panel", async ({ page }) => {
  await setup(page, { role: "anonymous" });
  await page.goto(event.url);
  await expect(page.getByRole("link", { name: "Sign in to register", exact: true })).toHaveAttribute("href", `/login?next=${encodeURIComponent(`${event.url}#faction-registration`)}`);
  await expect(page.getByLabel("Choose your faction")).toHaveCount(0);
});

test("members without a faction to lead see the leader requirement", async ({ page }) => {
  await setup(page, { role: "member" });
  await page.goto(event.url);
  const panel = page.getByRole("region", { name: "Faction registration", exact: true });
  await expect(panel).toContainText("Only faction leaders can register.");
  await expect(panel.getByRole("link", { name: "Register a new faction", exact: true })).toHaveAttribute("href", "/register");
  await expect(panel.getByRole("button", { name: "Register faction", exact: true })).toHaveCount(0);
});

test("closed events show existing entries without registration or withdrawal controls", async ({ page }) => {
  await setup(page, { closed: true, registered: true });
  await page.goto(event.url);
  const panel = page.getByRole("region", { name: "Faction registration", exact: true });
  await expect(panel).toContainText("Registration closed");
  await expect(panel.getByRole("list", { name: "Your registered factions" })).toContainText("Blackwater");
  await expect(panel.getByRole("button")).toHaveCount(0);
  await expect(panel.getByLabel("Choose your faction")).toHaveCount(0);
});

test("restricted leaders cannot submit an event registration", async ({ page }) => {
  const state = await setup(page, { role: "restricted" });
  await page.goto(event.url);
  const panel = page.getByRole("region", { name: "Faction registration", exact: true });
  await expect(panel.getByRole("alert")).toContainText("Your account is restricted.");
  await expect(panel.getByRole("button", { name: "Register faction", exact: true })).toHaveCount(0);
  expect(state.posts).toEqual([]);
});

test("registration closing during submission refreshes the panel and shows the server error", async ({ page }) => {
  const state = await setup(page);
  await page.goto(event.url);
  const panel = page.getByRole("region", { name: "Faction registration", exact: true });
  await expect(panel.getByLabel("Choose your faction")).toBeVisible();
  state.open = false;
  await panel.getByRole("button", { name: "Register faction", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Registration is closed for this event.");
  await expect(panel).toContainText("Registration closed");
  await expect(panel.getByLabel("Choose your faction")).toHaveCount(0);
  expect(state.posts).toEqual([]);
});
