import { test, expect } from "@playwright/test";
import { fixtureApi } from "./fixtures";
test.beforeEach(async ({ page }) => {
  await fixtureApi(page);
});

test("DAWEST introduction completes and can be replayed and skipped", async ({
  page,
}) => {
  await page.goto("/");
  const intro = page.getByRole("dialog", {
    name: "DaWest loading introduction",
  });
  await expect(intro).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveAttribute("inert", "");
  await expect(
    page.getByRole("progressbar", { name: "Intro progress" }),
  ).toBeVisible();
  await expect(
    intro.getByRole("heading", { name: "DAWEST", exact: true }),
  ).toBeVisible();
  await expect(intro).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator(".app-shell")).not.toHaveAttribute("inert", "");
  await expect(page.locator(".hero h1")).toHaveAccessibleName("DAWEST");
  await expect(
    page.locator(".frontier-mark,.revolver-composition"),
  ).toHaveCount(0);
  await expect(page.locator(".hero h1")).toHaveCSS(
    "color",
    "rgb(240, 240, 240)",
  );
  await page.reload();
  await expect(intro).toHaveCount(0);
  await page.getByRole("button", { name: "REPLAY INTRO" }).click();
  await expect(intro).toBeVisible();
  await page.getByRole("button", { name: "Skip intro" }).click();
  await expect(intro).toHaveCount(0);
  await page.getByRole("button", { name: "REPLAY INTRO" }).click();
  await expect(intro).toBeVisible();
  await page.keyboard.press("Space");
  await expect(intro).toHaveCount(0);
});

test("reduced motion skips VHS animation and keeps both ladders usable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?ranking=teams");
  await expect(
    page.getByRole("dialog", { name: "DaWest loading introduction" }),
  ).toHaveCount(0, { timeout: 5000 });
  await expect(
    page.getByRole("heading", { name: "TEAM POWER RANKINGS" }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await page
    .getByRole("button", { name: "Player rankings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "POWER RANKINGS", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".hero h1")).toHaveAccessibleName("DAWEST");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
