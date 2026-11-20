import { test, expect } from "@playwright/test";

test("player signup and developer login are separate and no signup grants staff", async ({
  page,
}, testInfo) => {
  await page.route("**/api/v1/auth/session/", (route) =>
    route.fulfill({
      json: { authenticated: false, user: null, csrf_token: "test" },
    }),
  );
  let payload: Record<string, unknown> | undefined;
  await page.route("**/api/v1/auth/signup/", async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({
      status: 400,
      json: { password: ["Use a less common password."] },
    });
  });
  await page.goto("/signup");
  await expect(
    page.getByRole("heading", { name: "CREATE PLAYER ACCOUNT" }),
  ).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill("newplayer");
  await page.getByLabel("Display name", { exact: true }).fill("New Player");
  await page.getByLabel("Password", { exact: true }).fill("long-password");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("long-password");
  await page
    .getByRole("button", { name: "Create player account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Use a less common password.",
  );
  expect(payload).not.toHaveProperty("is_staff");
  expect(payload).not.toHaveProperty("role");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/signup-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.goto("/dev/login");
  await expect(
    page.getByRole("heading", { name: "DEVELOPER LOGIN" }),
  ).toBeVisible();
  await expect(page.getByLabel("Display name", { exact: true })).toHaveCount(0);
  await page.route("**/api/v1/auth/dev-login/", (route) =>
    route.fulfill({
      status: 400,
      json: { detail: "Invalid developer credentials." },
    }),
  );
  await page.getByLabel("Username", { exact: true }).fill("ordinaryplayer");
  await page.getByLabel("Password", { exact: true }).fill("password-test");
  await page
    .getByRole("button", { name: "Sign in to developer console" })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Invalid developer credentials.",
  );
});

test("anonymous registration and ordinary developer access are gated", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/session/", (route) =>
    route.fulfill({
      json: { authenticated: false, user: null, csrf_token: "test" },
    }),
  );
  await page.goto("/register");
  await expect(
    page.getByRole("heading", { name: "REGISTERED PLAYERS ONLY." }),
  ).toBeVisible();
  await expect(page.getByLabel("Contact email", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Submit team registration" }),
  ).toHaveCount(0);
  await page.goto("/dev");
  await expect(
    page.getByRole("heading", { name: "DEVELOPER ACCESS REQUIRED." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add player" })).toHaveCount(0);
});
