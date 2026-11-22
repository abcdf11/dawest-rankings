import { test, expect } from "@playwright/test";
import { fixtureApi } from "./fixtures";
import type { CompetitionEvent } from "../../frontend/src/types/events";

const events: CompetitionEvent[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    title: "DaWest Solo Open",
    description: "Solo matches. Best of nine rounds.",
    format: "SOLO",
    region: "GLOBAL",
    location: "Online",
    starts_at: "2026-12-10T10:00:00Z",
    ends_at: "2026-12-10T14:00:00Z",
    status: "UPCOMING",
    registration_url: "https://example.com/register",
    url: "/events/11111111-1111-1111-1111-111111111111",
    updated_at: "2026-11-21T10:00:00Z",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    title: "Faction League",
    description: "Faction group matches.",
    format: "FACTION",
    region: "NA",
    location: "Online",
    starts_at: "2026-11-21T10:00:00Z",
    ends_at: null,
    status: "LIVE",
    registration_url: "",
    url: "/events/22222222-2222-2222-2222-222222222222",
    updated_at: "2026-11-21T10:00:00Z",
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    title: "November Cup",
    description: "Completed solo event.",
    format: "SOLO",
    region: "EU",
    location: "Online",
    starts_at: "2026-11-10T10:00:00Z",
    ends_at: "2026-11-10T14:00:00Z",
    status: "COMPLETED",
    registration_url: "",
    url: "/events/33333333-3333-3333-3333-333333333333",
    updated_at: "2026-11-21T10:00:00Z",
  },
];
test.beforeEach(async ({ page }) => {
  await fixtureApi(page);
  await page.addInitScript(() =>
    sessionStorage.setItem("dawest:intro-seen:v1", "1"),
  );
  await page.route("**/api/v1/events/", (route) =>
    route.fulfill({ json: { events } }),
  );
  await page.route("**/api/v1/events/*/", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2);
    const event = events.find((event) => event.id === id);
    return event
      ? route.fulfill({
          json: {
            ...event,
            matches:
              event.status === "COMPLETED"
                ? [
                    {
                      id: 1,
                      a: { name: "Deadeye", url: "/players/deadeye" },
                      b: { name: "Vex", url: "/players/vex" },
                      score_a: 5,
                      score_b: 2,
                      played_at: event.starts_at,
                      status: "COMPLETED",
                    },
                  ]
                : [],
          },
        })
      : route.fulfill({ status: 404, json: { detail: "Not found." } });
  });
});

test("Events navigation works on desktop and mobile with status and format filters", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Events", exact: true })
    .click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(
    page.getByRole("heading", { name: "Events", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".event-card")).toHaveCount(3);
  await page.getByRole("tab", { name: /^Upcoming/ }).click();
  await expect(page.locator(".event-card")).toHaveCount(1);
  await expect(page.locator(".event-card")).toContainText("DaWest Solo Open");
  await page.getByRole("tab", { name: /^Live/ }).click();
  await expect(page.locator(".event-card")).toContainText("Faction League");
  await page.getByRole("tab", { name: /^All/ }).click();
  await page
    .getByLabel("Event format", { exact: true })
    .selectOption("FACTION");
  await expect(page.locator(".event-card")).toHaveCount(1);
  await page.getByLabel("Search events", { exact: true }).fill("missing");
  await expect(
    page.getByRole("heading", { name: "No matching events" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.locator(".event-card")).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/events-${info.project.name}.png`,
    fullPage: true,
  });
});

test("event detail has schedule, registration link, and verified results with profile links", async ({
  page,
}) => {
  await page.goto(events[0].url);
  await expect(
    page.getByRole("heading", { name: "DaWest Solo Open", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Registration link", exact: true }),
  ).toHaveAttribute("href", "https://example.com/register");
  await expect(page.getByText("No verified results yet.")).toBeVisible();
  await page.goto(events[2].url);
  await expect(page.locator(".event-result")).toContainText("5 : 2");
  await expect(
    page.getByRole("link", { name: "Registration link" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Deadeye", exact: true }).click();
  await expect(page).toHaveURL(/\/players\/deadeye$/);
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Events", exact: true }),
  ).toBeVisible();
});

test("empty events and missing event details have clear states", async ({
  page,
}) => {
  await page.route("**/api/v1/events/", (route) =>
    route.fulfill({ json: { events: [] } }),
  );
  await page.goto("/events");
  await expect(
    page.getByRole("heading", { name: "No events yet" }),
  ).toBeVisible();
  await page.goto("/events/99999999-9999-9999-9999-999999999999");
  await expect(
    page.getByRole("heading", { name: "Event not found" }),
  ).toBeVisible();
});

test("event cards preview registered teams and link to the full public team list", async ({
  page,
}, info) => {
  const teams = [
    "Blackwater Crew",
    "Outlaw Union",
    "Midnight Riders",
    "Frontier Guard",
    "Red Canyon",
  ].map((name, index) => ({
    slug: `team-${index}`,
    name,
    tag: `TM${index}`,
    url: `/factions/team-${index}`,
    logo_url: "/favicon.svg",
  }));
  const event = { ...events[1], teams, team_count: teams.length };
  await page.route("**/api/v1/events/", (route) =>
    route.fulfill({ json: { events: [event] } }),
  );
  await page.route(`**/api/v1/events/${event.id}/`, (route) =>
    route.fulfill({ json: { ...event, matches: [] } }),
  );
  await page.route(`**/api/v1/events/${event.id}/entries/`, (route) =>
    route.fulfill({
      json: { entries: teams, my_teams: [], registration_open: false },
    }),
  );
  await page.route(`**/api/v1/events/${event.id}/pickems/`, (route) =>
    route.fulfill({
      json: {
        matchups: [],
        leaderboard: [],
        me: null,
        can_pick: false,
        participants: 0,
      },
    }),
  );
  await page.goto("/events");
  const card = page.locator(".event-card");
  await expect(
    card.getByRole("heading", { name: "Registered teams (5)", exact: true }),
  ).toBeVisible();
  await expect(
    card
      .getByRole("list", { name: "Registered teams", exact: true })
      .getByRole("listitem"),
  ).toHaveCount(4);
  await expect(
    card.getByRole("link", { name: /Blackwater Crew/ }),
  ).toHaveAttribute("href", "/factions/team-0");
  await expect(card.locator(".event-team-grid img").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/event-team-cards-${info.project.name}.png`,
    fullPage: true,
  });
  await card
    .getByRole("link", { name: "View all 5 teams", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${event.id}#event-teams-title$`));
  const list = page.getByRole("region", {
    name: "Registered teams",
    exact: true,
  });
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await expect(list).toContainText("5 registered");
  await expect(list.getByRole("link", { name: /Red Canyon/ })).toHaveAttribute(
    "href",
    "/factions/team-4",
  );
  expect((await list.boundingBox())!.y).toBeLessThan(
    (await page.locator(".event-description").boundingBox())!.y,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/event-team-list-${info.project.name}.png`,
    fullPage: true,
  });
});

test("a faction event with no signups shows an empty registered team list", async ({
  page,
}) => {
  await page.route("**/api/v1/events/", (route) =>
    route.fulfill({
      json: { events: [{ ...events[1], teams: [], team_count: 0 }] },
    }),
  );
  await page.goto("/events");
  await expect(
    page.getByRole("heading", { name: "Registered teams (0)", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No teams registered yet.", { exact: true }),
  ).toBeVisible();
});

test("developer creates, publishes, edits, and unpublishes events", async ({
  page,
}, info) => {
  await page.route("**/api/v1/auth/session/", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        csrf_token: "test-csrf",
        user: {
          id: 900,
          username: "developer",
          is_developer: true,
          player: null,
        },
      },
    }),
  );
  await page.route("**/api/v1/dev/dashboard/", (route) =>
    route.fulfill({
      json: {
        stats: { players: 0, teams: 0, pending: 0 },
        players: [],
        teams: [],
        registrations: [],
        audit: [],
      },
    }),
  );
  let records: CompetitionEvent[] = [];
  await page.route("**/api/v1/dev/events/", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { events: records } });
    const input = route.request().postDataJSON();
    expect(input.starts_at).toMatch(/Z$/);
    expect(input.ends_at).toMatch(/Z$/);
    records = [{ ...events[0], ...input, configured_status: input.status }];
    return route.fulfill({ status: 201, json: records[0] });
  });
  await page.route("**/api/v1/dev/events/*/", (route) => {
    records[0] = { ...records[0], ...route.request().postDataJSON() };
    return route.fulfill({ json: records[0] });
  });
  await page.goto("/dev#events");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "CREATE EVENT" });
  await dialog.getByLabel("Event title", { exact: true }).fill("December Open");
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Solo event registration details.");
  await dialog
    .getByLabel("Start time", { exact: true })
    .fill("2026-12-10T10:00");
  await dialog.getByLabel("End time", { exact: true }).fill("2026-12-10T14:00");
  await dialog
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".dev-event-list article")).toContainText("Draft");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.locator(".dev-event-list article")).toContainText(
    "Published",
  );
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editing = page.getByRole("dialog", { name: "EDIT EVENT" });
  await editing
    .getByLabel("Event title", { exact: true })
    .fill("December Open Updated");
  await editing
    .getByRole("button", { name: "Save event", exact: true })
    .click();
  await expect(editing).toHaveCount(0);
  await expect(page.locator(".dev-event-list article")).toContainText(
    "December Open Updated",
  );
  await page.getByRole("button", { name: "Unpublish", exact: true }).click();
  await expect(page.locator(".dev-event-list article")).toContainText("Draft");
  await page.reload();
  await expect(page.locator(".dev-event-list article")).toContainText(
    "December Open Updated",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/event-manager-${info.project.name}.png`,
    fullPage: true,
  });
});
