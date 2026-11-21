// Creates event fixtures only in an isolated localhost database under artifacts/.
import { chromium, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";

const origin = new URL(process.env.NATIVE_TEST_URL || "http://127.0.0.1:8002");
const database = resolve(
  process.env.SQLITE_PATH || "artifacts/native-render-smoke.sqlite3",
);
if (
  !["127.0.0.1", "localhost"].includes(origin.hostname) ||
  !database.startsWith(resolve("artifacts") + sep) ||
  !database.endsWith(".sqlite3")
)
  throw new Error(
    "Event fixtures require localhost and an isolated database under artifacts/.",
  );
const stamp = Date.now();
const username = `events_${stamp}`;
const password = `Frontier!${randomBytes(16).toString("hex")}`;
const setup = spawnSync(
  resolve(
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  ),
  ["backend-django/manage.py", "create_dev", "--from-env"],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      USE_SQLITE: "1",
      USE_REDIS: "0",
      SQLITE_PATH: database,
      DAWEST_BOOTSTRAP_DEV_USERNAME: username,
      DAWEST_BOOTSTRAP_DEV_PASSWORD: password,
    },
  },
);
if (setup.status !== 0)
  throw new Error("Could not create the isolated event developer fixture.");
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
try {
  const context = await browser.newContext({ timezoneId: "UTC" });
  await context.request.get(new URL("/api/v1/auth/session/", origin).href);
  const csrf = (await context.cookies(origin.origin)).find(
    (cookie) => cookie.name === "csrftoken",
  )?.value;
  const signedIn = await context.request.post(
    new URL("/api/v1/auth/dev-login/", origin).href,
    {
      data: { username, password },
      headers: { "X-CSRFToken": csrf, Origin: origin.origin },
    },
  );
  expect(signedIn.status()).toBe(200);
  const page = await context.newPage();
  await page.goto(new URL("/dev#events", origin).href);
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "CREATE EVENT" });
  const title = `QA Event ${stamp}`;
  const start = new Date(stamp + 7 * 86400000).toISOString().slice(0, 16);
  const end = new Date(stamp + 7 * 86400000 + 7200000)
    .toISOString()
    .slice(0, 16);
  await dialog.getByLabel("Event title", { exact: true }).fill(title);
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Isolated event integration fixture.");
  await dialog.getByLabel("Start time", { exact: true }).fill(start);
  await dialog.getByLabel("End time", { exact: true }).fill(end);
  await dialog
    .getByLabel("Registration URL", { exact: true })
    .fill("https://example.com/event-registration");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/dev/events/") &&
      response.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  const response = await created;
  expect(response.status()).toBe(201);
  const event = await response.json();
  expect(new Date(event.starts_at).toISOString()).toBe(`${start}:00.000Z`);
  await expect(dialog).toHaveCount(0);
  const row = page
    .locator(".dev-event-list article")
    .filter({ hasText: title });
  await expect(row).toContainText("Draft");
  const anonymous = await browser.newContext();
  const publicUrl = new URL(`/api/v1/events/${event.id}/`, origin).href;
  expect((await anonymous.request.get(publicUrl)).status()).toBe(404);
  expect(
    (
      await anonymous.request.post(
        new URL("/api/v1/dev/events/", origin).href,
        { data: { title: "Unauthorized" } },
      )
    ).status(),
  ).toBe(403);
  await row.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(row).toContainText("Published");
  const publicPage = await anonymous.newPage();
  await publicPage.goto(new URL("/events", origin).href);
  await publicPage.locator(".event-card").filter({ hasText: title }).click();
  await expect(
    publicPage.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    publicPage.getByRole("link", { name: "Registration link", exact: true }),
  ).toHaveAttribute("href", "https://example.com/event-registration");
  await publicPage.reload();
  await expect(
    publicPage.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "EDIT EVENT" });
  await editor
    .getByLabel("Event title", { exact: true })
    .fill(`${title} Updated`);
  await editor.getByRole("button", { name: "Save event", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await row.getByRole("button", { name: "Unpublish", exact: true }).click();
  await expect(row).toContainText("Draft");
  expect((await anonymous.request.get(publicUrl)).status()).toBe(404);
  await row.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(row).toContainText("Published");
  await publicPage.reload();
  await expect(
    publicPage.getByRole("heading", { name: `${title} Updated`, exact: true }),
  ).toBeVisible();
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await expect(
    publicPage
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Events", exact: true }),
  ).toBeVisible();
  expect(
    await publicPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await publicPage.screenshot({
    path: "artifacts/events-real-detail-mobile.png",
    fullPage: true,
  });
  writeFileSync(
    "artifacts/events-smoke.json",
    JSON.stringify({
      origin: origin.origin,
      id: event.id,
      title: `${title} Updated`,
      starts_at: event.starts_at,
    }),
  );
  console.log(
    "PASS: real developer session; event creation/editing/publishing/unpublishing; private drafts; public schedule and registration link; direct detail reload; mobile navigation; anonymous write denied. Isolated database only.",
  );
} finally {
  await browser.close();
}
