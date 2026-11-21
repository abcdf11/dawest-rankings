// Run against an isolated, migrated local database and the production frontend.
import { chromium, expect } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const origin = new URL(process.env.NATIVE_TEST_URL || "http://127.0.0.1:8002");
if (!["127.0.0.1", "localhost"].includes(origin.hostname)) {
  throw new Error(
    "Image upload fixtures require an isolated localhost service.",
  );
}
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
try {
  const context = await browser.newContext({ reducedMotion: "no-preference" });
  const page = await context.newPage();
  const username = `media_${Date.now()}`;
  const password = `Frontier!${randomBytes(12).toString("hex")}`;
  await page.goto(new URL("/signup", origin).href);
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page
    .getByLabel("Display name", { exact: true })
    .fill("Media Test Player");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create player account", exact: true })
    .click();
  await page.waitForURL(new URL(`/players/${username}`, origin).href);
  await page
    .getByRole("button", { name: "Customize profile", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "CUSTOMIZE PROFILE" });
  await dialog
    .getByLabel("Profile picture file")
    .setInputFiles(resolve("tests/fixtures/images/profile-avatar-wide.png"));
  await dialog
    .getByLabel("Profile banner file")
    .setInputFiles(
      resolve("tests/fixtures/images/profile-banner-animated.gif"),
    );
  const submitted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/auth/profile/appearance/") &&
      response.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Save images", exact: true })
    .click();
  const response = await submitted;
  expect(response.status()).toBe(200);
  const images = await response.json();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".profile-avatar img")).toHaveAttribute(
    "src",
    images.avatar_url,
  );
  await expect
    .poll(() =>
      page
        .locator(".profile-avatar img")
        .evaluate((image) => [image.naturalWidth, image.naturalHeight]),
    )
    .toEqual([256, 256]);
  const banner = page.getByAltText("Media Test Player's banner");
  await expect
    .poll(() =>
      banner.evaluate((image) => [image.naturalWidth, image.naturalHeight]),
    )
    .toEqual([1280, 240]);
  // Canvas drawImage intentionally samples an animation's default frame.
  // Compare actual browser-rendered pixels to verify GIF playback instead.
  await banner.scrollIntoViewIfNeeded();
  const frames = new Set();
  for (let index = 0; index < 5; index++) {
    frames.add(
      createHash("sha256")
        .update(await banner.screenshot({ animations: "allow" }))
        .digest("hex"),
    );
    await page.waitForTimeout(90);
  }
  expect(frames.size).toBeGreaterThan(1);
  await page.reload();
  await expect(page.locator(".profile-avatar img")).toHaveAttribute(
    "src",
    images.avatar_url,
  );
  const anonymous = await browser.newContext();
  const publicPage = await anonymous.newPage();
  await publicPage.goto(new URL(`/players/${username}`, origin).href);
  await expect(
    publicPage.getByAltText("Media Test Player's banner"),
  ).toBeVisible();
  await expect(
    publicPage.getByRole("button", { name: "Customize profile", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await anonymous.request.get(new URL(images.banner_url, origin).href)
    ).headers()["content-type"],
  ).toBe("image/gif");
  writeFileSync(
    "artifacts/profile-media-smoke.json",
    JSON.stringify({ origin: origin.origin, username, ...images }),
  );
  console.log(
    "PASS: real authenticated multipart upload; avatar 256x256; GIF banner 1280x240; browser animation plays; reload retains images; public visitors can view but cannot edit. Isolated database only.",
  );
} finally {
  await browser.close();
}
