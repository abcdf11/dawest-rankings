import { test, expect } from "@playwright/test";
import snapshot from "../../frontend/src/data/seed.json";
import teams from "../../frontend/src/data/teams.json";
import { fixtureApi } from "./fixtures";

const developerSession = {
  authenticated: true,
  csrf_token: "test-csrf",
  user: { id: 900, username: "developer", is_developer: true, player: null },
};
test.beforeEach(async ({ page }) => {
  await fixtureApi(page);
  await page.route("**/api/v1/auth/session/", (route) =>
    route.fulfill({ json: developerSession }),
  );
  await page.route("**/api/v1/dev/dashboard/", (route) =>
    route.fulfill({
      json: {
        stats: { players: 20, teams: 10, pending: 0 },
        players: snapshot.players.map((player) => ({
          ...player,
          is_active: true,
          is_restricted: false,
        })),
        teams: teams.teams.map((team) => ({ ...team, is_active: true })),
        registrations: [],
        audit: [],
      },
    }),
  );
});

test("developer adjusts player and faction Elo with a reason", async ({
  page,
}, info) => {
  const changes: Record<string, unknown>[] = [];
  await page.route("**/api/v1/dev/ratings/", (route) => {
    const body = route.request().postDataJSON();
    changes.push(body);
    return route.fulfill({
      json: {
        message: `Applied ${body.amount} Elo to ${body.kind}.`,
        operation_id: body.request_key,
      },
    });
  });
  await page.goto("/dev");
  await page.getByRole("button", { name: "Elo controls", exact: true }).click();
  await page
    .getByLabel("Player", { exact: true })
    .selectOption(String(snapshot.players[0].id));
  await page.getByLabel("Elo change", { exact: true }).fill("50.25");
  await expect(
    page.getByRole("button", { name: "Apply Elo change", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Verified result correction");
  await page
    .getByRole("button", { name: "Apply Elo change", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Applied 50.25 Elo to player.",
  );
  await page.getByLabel("Ladder", { exact: true }).selectOption("faction");
  await page
    .getByLabel("Faction", { exact: true })
    .selectOption(String(teams.teams[0].id));
  await page.getByLabel("Elo change", { exact: true }).fill("-20");
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Faction rating review");
  await page
    .getByRole("button", { name: "Apply Elo change", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Applied -20 Elo to faction.",
  );
  expect(changes.map((body) => [body.kind, body.amount, body.reason])).toEqual([
    ["player", "50.25", "Verified result correction"],
    ["faction", "-20", "Faction rating review"],
  ]);
  expect(changes[0].request_key).not.toBe(changes[1].request_key);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/admin-elo-${info.project.name}.png`,
    fullPage: true,
  });
});

test("admin terminal runs moderation commands and keeps errors visible", async ({
  page,
}, info) => {
  const commands: string[] = [];
  await page.route("**/api/v1/dev/commands/", (route) => {
    const { command, request_key } = route.request().postDataJSON();
    commands.push(command);
    return command === "whoami"
      ? route.fulfill({
          status: 400,
          json: { command: "Unknown command. Type help." },
        })
      : route.fulfill({
          json: {
            message: command.startsWith("ban ")
              ? "@deadeye: banned."
              : "@deadeye: restricted.",
            operation_id: request_key,
          },
        });
  });
  await page.goto("/dev");
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  const input = page.getByLabel("Admin command", { exact: true });
  await input.fill("ban deadeye Abusive behavior");
  await input.press("Enter");
  await expect(page.getByRole("log")).toContainText("@deadeye: banned.");
  await input.fill("restrict deadeye Review pending");
  await page.getByRole("button", { name: "Run command", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("@deadeye: restricted.");
  await input.fill("whoami");
  await input.press("Enter");
  await expect(page.getByRole("log")).toContainText(
    "Unknown command. Type help.",
  );
  expect(commands).toEqual([
    "ban deadeye Abusive behavior",
    "restrict deadeye Review pending",
    "whoami",
  ]);
  await input.press("ArrowUp");
  await expect(input).toHaveValue("whoami");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/admin-terminal-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Clear output", exact: true }).click();
  await expect(page.getByRole("log")).toBeEmpty();
});

test("ordinary accounts cannot see admin rating or terminal controls", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/session/", (route) =>
    route.fulfill({
      json: {
        ...developerSession,
        user: { ...developerSession.user, is_developer: false },
      },
    }),
  );
  await page.goto("/dev");
  await expect(
    page.getByRole("heading", { name: "DEVELOPER ACCESS REQUIRED." }),
  ).toBeVisible();
  await expect(page.getByLabel("Admin command")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Elo controls" })).toHaveCount(
    0,
  );
});

test("restricted player profile remains accessible and displays unranked status", async ({
  page,
}) => {
  await page.route("**/api/v1/players/deadeye/", (route) =>
    route.fulfill({
      json: {
        ...snapshot.players[0],
        ...snapshot.details.deadeye,
        is_restricted: true,
      },
    }),
  );
  await page.goto("/players/deadeye");
  await expect(
    page.getByText("Restricted account", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".profile-ranks")).toContainText("Unranked");
  await expect(
    page.getByRole("heading", { name: "Deadeye", exact: true }),
  ).toBeVisible();
});
