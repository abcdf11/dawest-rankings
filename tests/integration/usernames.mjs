// Requires an isolated, migrated localhost database and the production frontend.
import { chromium, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const origin = new URL(process.env.NATIVE_TEST_URL || "http://127.0.0.1:8002");
if (!["127.0.0.1", "localhost"].includes(origin.hostname))
  throw new Error("Username fixtures require an isolated localhost service.");
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {},
);
const stamp = Date.now();
const password = `Frontier!${randomBytes(12).toString("hex")}`;
const errors = [];
async function api(context, path, method = "GET", data) {
  const token = (await context.cookies(origin.origin)).find(
    (cookie) => cookie.name === "csrftoken",
  )?.value;
  return context.request.fetch(new URL(`/api/v1${path}`, origin).href, {
    method,
    ...(data ? { data } : {}),
    headers: {
      ...(token ? { "X-CSRFToken": token } : {}),
      Origin: origin.origin,
    },
  });
}
async function signup(context, username) {
  await api(context, "/auth/session/");
  expect(
    (
      await api(context, "/auth/signup/", "POST", {
        username,
        display_name: "Username Test Player",
        region: "NA",
        password,
        password_confirm: password,
      })
    ).status(),
  ).toBe(201);
}
async function fits(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
try {
  const takenName = `taken_${stamp}`;
  const taken = await browser.newContext();
  await signup(taken, takenName);
  for (const [index, [name, viewport]] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 393, height: 851 }],
  ].entries()) {
    const original = `before_${stamp}_${index}`;
    const renamed = `after_${stamp}_${index}`;
    const context = await browser.newContext({ viewport });
    await signup(context, original);
    const token = (await context.cookies(origin.origin)).find(
      (cookie) => cookie.name === "csrftoken",
    )?.value;
    const upload = await context.request.post(
      new URL("/api/v1/auth/profile/appearance/", origin).href,
      {
        headers: { "X-CSRFToken": token, Origin: origin.origin },
        multipart: {
          avatar: {
            name: "avatar.png",
            mimeType: "image/png",
            buffer: readFileSync(
              "tests/fixtures/images/profile-avatar-wide.png",
            ),
          },
        },
      },
    );
    expect(upload.status()).toBe(200);
    const oldAvatarUrl = (await upload.json()).avatar_url;
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(new URL(`/players/${original}`, origin).href);
    await page
      .getByRole("button", { name: "Change username", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "CHANGE USERNAME",
      exact: true,
    });
    await expect(
      editor.getByRole("button", { name: "Save username", exact: true }),
    ).toBeDisabled();
    await editor
      .getByLabel("New username", { exact: true })
      .fill("invalid name");
    expect(
      await editor
        .getByLabel("New username", { exact: true })
        .evaluate((input) => input.checkValidity()),
    ).toBe(false);
    await editor.getByLabel("New username", { exact: true }).fill(takenName);
    await editor
      .getByRole("button", { name: "Save username", exact: true })
      .click();
    await expect(editor.getByRole("alert")).toContainText("already registered");
    expect(
      (await (await api(context, "/auth/session/")).json()).user.username,
    ).toBe(original);
    await editor.getByLabel("New username", { exact: true }).fill(renamed);
    await fits(page);
    await editor.screenshot({ path: `artifacts/username-editor-${name}.png` });
    const changed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/auth/username/") &&
        response.request().method() === "POST",
    );
    await editor
      .getByRole("button", { name: "Save username", exact: true })
      .click();
    expect((await changed).status()).toBe(200);
    await page.waitForURL(new URL(`/players/${renamed}`, origin).href);
    await expect(
      page.getByRole("link", { name: "View your profile", exact: true }),
    ).toHaveAttribute("href", `/players/${renamed}`);
    await expect(page.getByRole("link", { name: "View your profile", exact: true })).toBeVisible();
    await expect(page.locator(".profile-name")).toContainText(`@${renamed}`);
    await expect(page.locator(".profile-avatar img")).toHaveAttribute(
      "src",
      new RegExp(`/players/${renamed}/media/`),
    );
    await expect
      .poll(() =>
        page
          .locator(".profile-avatar img")
          .evaluate((image) => image.naturalWidth),
      )
      .toBe(256);
    await fits(page);
    await page.screenshot({
      path: `artifacts/renamed-profile-${name}.png`,
      fullPage: true,
    });
    await page.goto(new URL("/events", origin).href);
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await expect(editor).toContainText(`@${renamed}`);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    const publicContext = await browser.newContext({ viewport });
    const shared = await publicContext.newPage();
    shared.on("pageerror", (error) => errors.push(error.message));
    await shared.goto(new URL(`/players/${original}#matches`, origin).href);
    await shared.waitForURL(
      new URL(`/players/${renamed}#matches`, origin).href,
    );
    await expect(
      shared.getByRole("heading", {
        name: "Username Test Player",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      shared.getByRole("button", { name: "Change username", exact: true }),
    ).toHaveCount(0);
    await expect(
      shared.getByRole("button", { name: "Account settings", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await publicContext.request.get(new URL(oldAvatarUrl, origin).href)
      ).status(),
    ).toBe(200);
    const login = await browser.newContext();
    await api(login, "/auth/session/");
    expect(
      (
        await api(login, "/auth/login/", "POST", {
          username: original,
          password,
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await api(login, "/auth/login/", "POST", {
          username: renamed,
          password,
        })
      ).status(),
    ).toBe(200);
    await page.reload();
    expect(
      (await (await api(context, "/auth/session/")).json()).user.username,
    ).toBe(renamed);
    await fits(page);
  }
  expect(errors).toEqual([]);
  console.log(
    "Desktop/mobile username editing, duplicate-name errors, new login, session persistence, canonical shared links, retained images and private account controls passed.",
  );
} finally {
  await browser.close();
}
