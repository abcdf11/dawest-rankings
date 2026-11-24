import { test, expect, type Page } from "@playwright/test";
import { fixtureApi } from "./fixtures";

const identity = { user_id: 123456, username: "RobloxGuy", display_name: "Roblox Guy", linked_at: "2026-11-24T01:00:00Z" };

async function setup(page: Page, options: { available?: boolean; linked?: boolean; lifetime?: number } = {}) {
  await fixtureApi(page);
  await page.addInitScript(() => sessionStorage.setItem("dawest:intro-seen:v1", "1"));
  const state = { available: options.available ?? true, roblox: options.linked ? identity : null, expires_at: null as string | null, issues: 0 };
  await page.route("**/api/v1/auth/session/", (route) => route.fulfill({ json: {
    authenticated: true, csrf_token: "test-csrf",
    user: { id: 1, username: "deadeye", is_developer: false, roblox_link_available: state.available,
      player: { id: 1, username: "deadeye", display_name: "Deadeye", region: "NA", rating: 1500, rank: 1, is_active: true, roblox: state.roblox } },
  } }));
  await page.route("**/api/v1/auth/roblox/link/", (route) => {
    if (route.request().method() === "POST") {
      state.issues++;
      state.expires_at = new Date(Date.now() + (options.lifetime ?? 600_000)).toISOString();
      return route.fulfill({ status: 201, json: { code: state.issues === 1 ? "ABCDE23456" : "FGHJK67892", expires_at: state.expires_at } });
    }
    if (route.request().method() === "DELETE") state.expires_at = null;
    return route.fulfill({ json: state });
  });
  await page.route("**/api/v1/auth/roblox/unlink/", (route) => {
    state.roblox = null;
    state.expires_at = null;
    return route.fulfill({ json: { linked: false } });
  });
  await page.goto("/players/deadeye");
  return state;
}

test("generate and replace a private code with responsive game instructions", async ({ page }, info) => {
  const state = await setup(page);
  const card = page.locator(".profile-roblox");
  await card.getByRole("button", { name: "Get link code", exact: true }).click();
  await expect(card.getByLabel("Roblox link code")).toHaveText("ABCDE23456");
  expect((await card.getByLabel("Roblox link code").boundingBox())?.height).toBeLessThan(40);
  await expect(card.getByRole("timer")).toContainText("Expires in");
  await expect(card).toContainText("Settings → Ranked");
  await expect(card.getByRole("link", { name: "Log in with Roblox" })).toHaveCount(0);
  await card.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/roblox-link-${info.project.name}.png`, fullPage: true });
  await card.getByRole("button", { name: "New link code", exact: true }).click();
  await expect(card.getByLabel("Roblox link code")).toHaveText("FGHJK67892");
  expect(state.issues).toBe(2);
});

test("polling detects game verification and removes the usable code", async ({ page }) => {
  const state = await setup(page);
  const card = page.locator(".profile-roblox");
  await card.getByRole("button", { name: "Get link code", exact: true }).click();
  await expect(card.getByLabel("Roblox link code")).toBeVisible();
  state.roblox = identity;
  state.expires_at = null;
  await expect(card).toContainText("Linked to Roblox Guy", { timeout: 10_000 });
  await expect(card.getByLabel("Roblox link code")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Unlink Roblox" })).toBeVisible();
});

test("cancel removes the pending code and lets the user start again", async ({ page }) => {
  const state = await setup(page);
  const card = page.locator(".profile-roblox");
  await card.getByRole("button", { name: "Get link code", exact: true }).click();
  await card.getByRole("button", { name: "Cancel linking" }).click();
  await expect(card.getByLabel("Roblox link code")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Get link code", exact: true })).toBeEnabled();
  expect(state.expires_at).toBeNull();
});

test("expired code disables copying and offers a new code", async ({ page }) => {
  await setup(page, { lifetime: 1500 });
  const card = page.locator(".profile-roblox");
  await card.getByRole("button", { name: "Get link code", exact: true }).click();
  await expect(card.getByRole("timer")).toHaveText("Code expired. Get a new link code.");
  await expect(card.getByRole("button", { name: "Copy code" })).toBeDisabled();
  await expect(card.getByRole("button", { name: "New link code", exact: true })).toBeEnabled();
});

test("existing links survive and can be unlinked", async ({ page }) => {
  await setup(page, { linked: true });
  const card = page.locator(".profile-roblox");
  await expect(card).toContainText("Linked to Roblox Guy");
  await card.getByRole("button", { name: "Unlink Roblox" }).click();
  await expect(card.getByRole("button", { name: "Get link code", exact: true })).toBeEnabled();
  await expect(card.getByRole("status")).toHaveText("Roblox account unlinked.");
});

test("unconfigured linking shows a useful message without an OAuth redirect", async ({ page }) => {
  await setup(page, { available: false });
  const card = page.locator(".profile-roblox");
  await expect(card).toContainText("Roblox account linking is temporarily unavailable.");
  await expect(card.getByRole("button", { name: "Get link code", exact: true })).toHaveCount(0);
  await expect(card.locator("a[href*='roblox/start']")).toHaveCount(0);
});
