import { test, expect } from "@playwright/test";
import { fixtureApi } from "./fixtures";
import snapshot from "../../frontend/src/data/seed.json";

const playerSession = {
  authenticated: true,
  csrf_token: "test-csrf",
  user: {
    id: 1,
    username: "deadeye",
    is_developer: false,
    player: {
      id: 1,
      username: "deadeye",
      display_name: "Deadeye",
      region: "NA",
      rating: 2287.85,
      rank: 1,
      is_active: true,
    },
  },
};

test.beforeEach(async ({ page }) => {
  await fixtureApi(page);
  await page.addInitScript(() =>
    sessionStorage.setItem("dawest:intro-seen:v1", "1"),
  );
});

test("new accounts show an honest empty record and a single registration point", async ({ page }) => {
  await page.route("**/api/v1/players/fresh-player/", (route) => route.fulfill({ json: {
    ...snapshot.players[0], username: "fresh-player", display_name: "Fresh Player", rank: 21, regional_rank: 5,
    tier: "GUNSLINGER", rating: 1500, peak_rating: 1500, wins: 0, losses: 0, win_rate: 0, current_streak: 0,
    rank_delta: 0, team: null, registered_at: "2026-11-21T01:00:00Z", matches: [],
    history: [{ rating: 1500, rank: 21, recorded_at: "2026-11-21T01:00:00Z", event_label: "Account registration" }],
  } }));
  await page.goto("/players/fresh-player");
  await expect(page.getByRole("heading", { name: "Fresh Player", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No matches recorded yet." })).toBeVisible();
  await expect(page.locator(".profile-milestones > li.unlocked")).toHaveCount(1);
  await expect(page.getByRole("slider", { name: "Inspect performance history" })).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("player profile has ranks, interactive history, real milestones, and responsive layout", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/players/deadeye");
  await expect(
    page.getByRole("heading", { name: "Deadeye", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Performance history", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".profile-ranks")).toContainText("Global ranking");
  await expect(page.locator(".profile-milestones > li")).toHaveCount(6);
  await page.getByRole("button", { name: "Global rank", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Deadeye's global rank history" }),
  ).toBeVisible();
  const history = page.getByRole("slider", {
    name: "Inspect performance history",
  });
  await history.focus();
  await history.press("Home");
  await expect(history).toHaveValue("0");
  await history.press("End");
  await page.getByRole("button", { name: "Power rating", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Deadeye's power rating history" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/profile-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("profile tabs filter matches, open opponents, and show activity", async ({
  page,
}) => {
  await page.goto("/players/deadeye");
  await page.getByRole("tab", { name: "Matches", exact: true }).click();
  await expect(page).toHaveURL(/#matches$/);
  await expect(page.locator(".profile-match-row")).toHaveCount(12);
  await page.getByRole("button", { name: /^Losses/ }).click();
  await expect(
    page.getByRole("heading", { name: "No losses in recent matches." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^All results/ }).click();
  await page.locator(".profile-match-row a").first().click();
  await expect(page).toHaveURL(/\/players\/highnoon$/);
  await expect(
    page.getByRole("heading", { name: "HighNoon", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(page.locator(".profile-activity > li")).toHaveCount(20);
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Activity", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("my profile redirect and account link open the signed-in player's page", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/session/", (route) =>
    route.fulfill({ json: playerSession }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          document.documentElement.dataset.copiedProfile = value;
        },
      },
    });
  });
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/players\/deadeye$/);
  await expect(page.getByText("Your profile", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View your profile", exact: true }),
  ).toHaveAttribute("href", "/players/deadeye");
  await expect(page.getByRole("link", { name: "View your profile", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account settings", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Copy profile link" }).click();
  await expect(
    page.getByRole("button", { name: "Copy profile link" }),
  ).toContainText("Copied");
  expect(
    await page.evaluate(() => document.documentElement.dataset.copiedProfile),
  ).toMatch(/\/players\/deadeye$/);
});

test("anonymous profile redirects to login and missing players have a proper error page", async ({
  page,
}) => {
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login\?next=\/profile$/);
  await page.goto("/players/unknown-player");
  await expect(
    page.getByRole("heading", { name: "Player not found." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to rankings" }),
  ).toHaveAttribute("href", "/");
});

test("player login redirects to the profile and preserves an explicit return destination", async ({
  page,
}) => {
  let signedIn = false;
  await page.route("**/api/v1/auth/session/", (route) =>
    route.fulfill({
      json: signedIn
        ? playerSession
        : { authenticated: false, user: null, csrf_token: "test" },
    }),
  );
  await page.route("**/api/v1/auth/login/", (route) => {
    signedIn = true;
    return route.fulfill({ json: playerSession });
  });
  async function login(path: string) {
    await page.goto(path);
    await page.getByLabel("Username", { exact: true }).fill("deadeye");
    await page
      .getByLabel("Password", { exact: true })
      .fill("Test-only-password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
  }
  await login("/login");
  await expect(page).toHaveURL(/\/players\/deadeye$/);
  await login("/login?next=/register");
  await expect(page).toHaveURL(/\/register$/);
});
