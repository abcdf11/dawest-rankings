import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fixtureApi } from "./fixtures";
import snapshot from "../../frontend/src/data/seed.json";

const avatarFile = resolve("tests/fixtures/images/profile-avatar-wide.png");
const bannerFile = resolve("tests/fixtures/images/profile-banner-animated.gif");
const avatarUrl = "/api/v1/players/deadeye/media/avatar/test-avatar/";
const bannerUrl = "/api/v1/players/deadeye/media/banner/test-banner/";
const ownerSession = {
  authenticated: true,
  csrf_token: "test-csrf",
  user: {
    id: 1,
    username: "deadeye",
    is_developer: false,
    player: { ...snapshot.players[0], is_active: true },
  },
};

test("owner can preview, save, reload, and remove their picture and GIF banner", async ({
  page,
}, testInfo) => {
  await fixtureApi(page);
  await page.route("**/api/v1/auth/session/", (route) =>
    route.fulfill({ json: ownerSession }),
  );
  let appearance = { avatar_url: "", banner_url: "" };
  await page.route("**/api/v1/players/deadeye/", (route) =>
    route.fulfill({
      json: {
        ...snapshot.players[0],
        ...snapshot.details.deadeye,
        ...appearance,
      },
    }),
  );
  await page.route("**/api/v1/players/deadeye/media/**", (route) =>
    route.fulfill({
      contentType: route.request().url().includes("/avatar/")
        ? "image/png"
        : "image/gif",
      body: readFileSync(
        route.request().url().includes("/avatar/") ? avatarFile : bannerFile,
      ),
    }),
  );
  const requests: string[] = [];
  await page.route("**/api/v1/auth/profile/appearance/", (route) => {
    expect(route.request().headers()["content-type"]).toContain(
      "multipart/form-data; boundary=",
    );
    const body = route.request().postDataBuffer()!.toString("latin1");
    requests.push(body);
    appearance = body.includes('name="remove_avatar"')
      ? { avatar_url: "", banner_url: "" }
      : { avatar_url: avatarUrl, banner_url: bannerUrl };
    return route.fulfill({ json: appearance });
  });
  await page.goto("/players/deadeye");
  await page
    .getByRole("button", { name: "Customize profile", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "CUSTOMIZE PROFILE" });
  await expect(
    dialog.getByRole("button", { name: "Save images", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Profile picture file").setInputFiles(avatarFile);
  await dialog.getByLabel("Profile banner file").setInputFiles(bannerFile);
  await expect(dialog.getByAltText("Profile picture preview")).toBeVisible();
  await expect(dialog.getByAltText("Banner preview")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/appearance-editor-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Save images", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".profile-avatar img")).toHaveAttribute(
    "src",
    avatarUrl,
  );
  await expect(page.getByAltText("Deadeye's banner")).toHaveAttribute(
    "src",
    bannerUrl,
  );
  expect(requests[0]).toContain('name="avatar"');
  expect(requests[0]).toContain('name="banner"');
  await page.reload();
  await expect(page.locator(".profile-avatar img")).toHaveAttribute(
    "src",
    avatarUrl,
  );
  await page.screenshot({
    path: `artifacts/custom-profile-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Customize profile", exact: true })
    .click();
  await dialog
    .locator(".appearance-upload-card")
    .filter({ hasText: "Profile picture" })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await dialog
    .locator(".appearance-upload-card")
    .filter({ hasText: "Profile banner" })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save images", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".profile-avatar img")).toHaveCount(0);
  await expect(page.getByAltText("Deadeye's banner")).toHaveCount(0);
  expect(requests).toHaveLength(2);
});

test("other players do not get customization controls", async ({ page }) => {
  await fixtureApi(page);
  await page.route("**/api/v1/auth/session/", (route) =>
    route.fulfill({
      json: {
        ...ownerSession,
        user: {
          ...ownerSession.user,
          username: "otherplayer",
          player: { ...ownerSession.user.player, username: "otherplayer" },
        },
      },
    }),
  );
  await page.goto("/players/deadeye");
  await expect(
    page.getByRole("heading", { name: "Deadeye", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Customize profile", exact: true }),
  ).toHaveCount(0);
});

test("unsupported and oversized files show clear errors without submitting", async ({
  page,
}) => {
  await fixtureApi(page);
  await page.route("**/api/v1/auth/session/", (route) =>
    route.fulfill({ json: ownerSession }),
  );
  await page.goto("/players/deadeye");
  await page
    .getByRole("button", { name: "Customize profile", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "CUSTOMIZE PROFILE" });
  await dialog
    .getByLabel("Profile picture file")
    .setInputFiles({
      name: "vector.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg></svg>"),
    });
  await expect(dialog.getByRole("alert")).toContainText(
    "Use a PNG, JPG, WebP, or GIF",
  );
  await dialog
    .getByLabel("Profile picture file")
    .setInputFiles({
      name: "large.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(8 * 1024 * 1024 + 1),
    });
  await expect(dialog.getByRole("alert")).toContainText("up to 8 MB");
  await expect(
    dialog.getByRole("button", { name: "Save images", exact: true }),
  ).toBeDisabled();
});

test("reduced motion requests a still version of animated profile images", async ({
  page,
}) => {
  await fixtureApi(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/players/deadeye/", (route) =>
    route.fulfill({
      json: {
        ...snapshot.players[0],
        ...snapshot.details.deadeye,
        avatar_url: avatarUrl,
        banner_url: bannerUrl,
      },
    }),
  );
  await page.route("**/api/v1/players/deadeye/media/**", (route) =>
    route.fulfill({ contentType: "image/png", body: readFileSync(avatarFile) }),
  );
  await page.goto("/players/deadeye");
  await expect(page.locator(".profile-avatar img")).toHaveAttribute(
    "src",
    avatarUrl + "?still=1",
  );
  await expect(page.getByAltText("Deadeye's banner")).toHaveAttribute(
    "src",
    bannerUrl + "?still=1",
  );
});
