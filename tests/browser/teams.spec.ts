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
  await expect(page).toHaveURL(/\/factions\/blackwater$/);
  await expect(
    page.getByRole("heading", { name: "Blackwater", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".faction-member-profile")).toHaveCount(2);
  await page.getByRole("tab", { name: "Recent matches" }).click();
  await expect(page.locator(".faction-matches > a")).toHaveCount(12);
  await page.getByRole("tab", { name: "Members" }).click();
  await page
    .locator(".faction-member-profile")
    .filter({ hasText: "Deadeye" })
    .click();
  await expect(page).toHaveURL(/\/players\/deadeye$/);
  await expect(
    page.getByRole("heading", { name: "Deadeye", exact: true }),
  ).toBeVisible();
  await page.goto("/");
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
