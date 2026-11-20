import { test, expect } from "@playwright/test";
import { fixtureApi } from "./fixtures";
test.beforeEach(async ({ page }) => {
  await fixtureApi(page);
  await page.addInitScript(() =>
    sessionStorage.setItem("dawest:intro-seen:v1", "1"),
  );
});

test("team and player ladders stay separate and team profiles open roster players", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Team rankings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "TEAM POWER RANKINGS", exact: true }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await expect(page.locator("tbody")).toContainText("Blackwater");
  await page.getByRole("textbox", { name: "Search teams" }).fill("BLW");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.locator("tbody .table-player").first().click();
  await expect(
    page.getByRole("dialog", { name: "TEAM PROFILE" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "TEAM ROSTER" }),
  ).toBeVisible();
  await expect(page.locator(".roster-member")).toHaveCount(2);
  await expect(page.locator(".match-history-row")).toHaveCount(12);
  await page.locator(".roster-member").filter({ hasText: "Deadeye" }).click();
  await expect(
    page.getByRole("dialog", { name: "PLAYER PROFILE" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Deadeye", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Player rankings", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Team rankings", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Filter by region" })
    .selectOption("EU");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page
    .getByRole("combobox", { name: "Filter by region" })
    .selectOption("ALL");
  await page
    .getByRole("textbox", { name: "Search teams" })
    .fill("missing-team");
  await expect(
    page.getByRole("heading", { name: "No teams found" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .first()
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/teams-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("team simulator and team share links use the team ladder", async ({
  page,
}) => {
  await page.goto("/?ranking=teams");
  await page.getByRole("tab", { name: "What-if simulator" }).click();
  await expect(
    page.getByRole("heading", { name: "WHAT IF THEY CLASHED?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Simulate team match" }).click();
  await expect(
    page.getByRole("heading", { name: "PROJECTED OUTCOME" }),
  ).toBeVisible();
  await expect(page.locator(".result-grid>div")).toHaveCount(2);
  await page.getByRole("tab", { name: "Community tier list" }).click();
  await expect(
    page.getByRole("heading", { name: "BUILD YOUR TEAM LIST" }),
  ).toBeVisible();
  await expect(page.locator(".builder-list>li")).toHaveCount(10);
  const second = await page
    .locator(".builder-list>li")
    .nth(1)
    .locator("strong")
    .textContent();
  await page.getByRole("button", { name: `Move ${second} up` }).click();
  await page.getByRole("button", { name: "Share my ranking" }).click();
  await expect(page).toHaveURL(/ranking=teams.*#list=/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Team rankings", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".builder-list>li").first()).toContainText(second!);
  await page
    .getByRole("button", { name: "Player rankings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "BUILD YOUR POWER LIST" }),
  ).toBeVisible();
  await expect(page.locator(".builder-list>li").first()).toContainText(
    "Deadeye",
  );
});
