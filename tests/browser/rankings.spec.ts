import { test, expect } from "@playwright/test";
import { fixtureApi } from "./fixtures";
test.beforeEach(async ({ page }) => {
  await fixtureApi(page);
  await page.addInitScript(() =>
    sessionStorage.setItem("dawest:intro-seen:v1", "1"),
  );
});
test("ladder filters, sort, profile, and empty state work", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "POWER RANKINGS" }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await page.getByRole("button", { name: "Show more players" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(20);
  await page.getByRole("textbox", { name: "Search players" }).fill("deadeye");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("link", { name: "Deadeye @deadeye NA" }).click();
  await expect(page).toHaveURL(/\/players\/deadeye$/);
  await expect(
    page.getByRole("heading", { name: "Performance history" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Matches", exact: true }).click();
  await expect(page.locator(".profile-match-row")).toHaveCount(12);
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Search players" })
    .fill("no-such-player");
  await expect(
    page.getByRole("heading", { name: "No players found" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .first()
    .click();
  await page
    .getByRole("combobox", { name: "Filter by region" })
    .selectOption("ASIA");
  await expect(page.locator("tbody tr")).toHaveCount(4);
  await page
    .getByRole("combobox", { name: "Filter by region" })
    .selectOption("ALL");
  await page.getByRole("button", { name: "ROOKIE", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.getByRole("button", { name: "ALL PLAYERS" }).click();
  await page
    .getByRole("combobox", { name: "Sort players" })
    .selectOption("win");
  await expect(page.locator("tbody tr").first()).toContainText("Deadeye");
  expect(errors).toEqual([]);
});
test("methodology dialog and responsive canvas", async ({ page }, testInfo) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "How rankings work", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("old community links open the rankings without removed modes", async ({
  page,
}) => {
  await page.goto("/?ranking=teams#list=1.2.3");
  await expect(
    page.getByRole("heading", { name: "TEAM POWER RANKINGS", exact: true }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await expect(
    page.getByRole("tab", { name: "What-if simulator" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Community tier list" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "My tier list" })).toHaveCount(
    0,
  );
  await expect(page.locator(".builder,.simulator,.build-promo")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Player rankings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "POWER RANKINGS", exact: true }),
  ).toBeVisible();
});
