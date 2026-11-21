// Run only against an isolated local database, served by Django with DEBUG=0.
import { chromium, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";

const origin = new URL(process.env.NATIVE_TEST_URL || "http://127.0.0.1:8002");
if (!["127.0.0.1", "localhost"].includes(origin.hostname)) {
  throw new Error("Native deployment fixtures require an isolated localhost service.");
}
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => sessionStorage.setItem("dawest:intro-seen:v1", "1"));

  expect((await context.request.get(new URL("/api/v1/health/", origin).href)).status()).toBe(200);
  const home = await page.goto(origin.href);
  expect(home.status()).toBe(200);
  await expect(page.getByRole("link", { name: "Sign up", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Sign up", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create player account", exact: true })).toBeVisible();

  const username = `native_${Date.now()}`;
  const password = `Frontier!${randomBytes(12).toString("hex")}`;
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Display name", { exact: true }).fill("Native Render Player");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create player account", exact: true }).click();
  await page.waitForURL(new URL(`/players/${username}`, origin).href);
  await expect(page.locator(".account-username")).toContainText(username);
  await page.reload();
  await expect(page.locator(".account-username")).toContainText(username);
  await expect(page.getByRole("heading", { name: "Native Render Player", exact: true })).toBeVisible();
  await expect(page.getByText("No matches recorded yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Inspect performance history" })).toBeDisabled();
  expect((await context.request.get(new URL(`/players/${username}`, origin).href)).status()).toBe(200);
  await page.goto(new URL("/profile", origin).href);
  await page.waitForURL(new URL(`/players/${username}`, origin).href);
  await expect(page.getByRole("heading", { name: "Native Render Player", exact: true })).toBeVisible();
  await page.goto(origin.href);
  await expect(page.locator("tbody")).toContainText("Native Render Player");

  await page.goto(new URL("/register", origin).href);
  await expect(page.getByLabel("Captain username", { exact: true })).toHaveValue(username);
  expect((await context.request.get(new URL("/api/v1/missing/", origin).href)).status()).toBe(404);
  expect((await context.request.get(new URL("/assets/missing.js", origin).href)).status()).toBe(404);

  const developerPage = await browser.newPage();
  const developerLogin = await developerPage.goto(new URL("/dev/login", origin).href);
  expect(developerLogin.status()).toBe(200);
  await expect(developerPage.getByRole("button", { name: "Sign in to developer console", exact: true })).toBeVisible();
  console.log("PASS: Django serves the built React site and assets; signup, persistent same-origin login, leaderboard, registration, developer login, and API/asset 404s work. Isolated database only.");
} finally {
  await browser.close();
}
