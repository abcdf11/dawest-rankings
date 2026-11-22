// Real account, team signup, interest, inbox and logo flows on an isolated localhost database.
import { chromium, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve, sep } from "node:path";

const origin = new URL(process.env.NATIVE_TEST_URL || "http://127.0.0.1:8002");
const database = resolve(
  process.env.SQLITE_PATH || "artifacts/event-signups.sqlite3",
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
const username = `eventdev_${stamp}`;
const password = `Cup!${randomBytes(16).toString("hex")}`;
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
  throw new Error("Could not create isolated developer fixture.");
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {},
);

async function api(context, path, method = "GET", data) {
  const csrf = (await context.cookies(origin.origin)).find(
    (cookie) => cookie.name === "csrftoken",
  )?.value;
  return context.request.fetch(new URL(`/api/v1${path}`, origin).href, {
    method,
    ...(data ? { data } : {}),
    headers: {
      ...(csrf ? { "X-CSRFToken": csrf } : {}),
      Origin: origin.origin,
    },
  });
}
async function signup(name) {
  const context = await browser.newContext();
  await api(context, "/auth/session/");
  expect(
    (
      await api(context, "/auth/signup/", "POST", {
        username: name,
        display_name: name,
        region: "NA",
        password,
        password_confirm: password,
      })
    ).status(),
  ).toBe(201);
  return context;
}
async function fits(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

try {
  const dev = await browser.newContext({ timezoneId: "UTC" });
  await api(dev, "/auth/session/");
  expect(
    (
      await api(dev, "/auth/dev-login/", "POST", { username, password })
    ).status(),
  ).toBe(200);
  const leaderName = `captain_${stamp}`,
    memberName = `member_${stamp}`;
  const leader = await signup(leaderName),
    member = await signup(memberName);
  const teamName = `Cup Team ${stamp}`;
  const teamResponse = await api(dev, "/dev/teams/", "POST", {
    request_key: randomUUID(),
    team_name: teamName,
    tag: randomBytes(3).toString("hex").slice(0, 5),
    region: "NA",
    captain_username: leaderName,
    members: [leaderName, memberName].map((username) => ({
      username,
      display_name: username,
    })),
  });
  expect(teamResponse.status()).toBe(201);
  const team = await teamResponse.json();
  const page = await dev.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/dev#events", origin).href);
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "CREATE EVENT" });
  const title = `Team Cup ${stamp}`;
  await editor.getByLabel("Event title", { exact: true }).fill(title);
  await editor.getByLabel("Format", { exact: true }).selectOption("FACTION");
  await editor
    .getByLabel("Start time", { exact: true })
    .fill(new Date(stamp + 86400000).toISOString().slice(0, 16));
  await editor
    .getByLabel("Event logo", { exact: true })
    .setInputFiles("tests/fixtures/images/profile-avatar-wide.png");
  await expect(editor.getByAltText("Event logo preview")).toBeVisible();
  await editor.getByLabel("Publish event", { exact: true }).check();
  await editor.evaluate((element) => {
    element.scrollTop = 0;
  });
  await editor.screenshot({ path: "artifacts/event-logo-editor.png" });
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/dev/events/") &&
      response.request().method() === "POST",
  );
  await editor
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  const response = await created;
  expect(response.status()).toBe(201);
  const event = await response.json();
  expect(event.logo_url).toBeTruthy();
  await expect(editor).toHaveCount(0);
  const eventUrl = new URL(event.url, origin).href;
  const captain = await leader.newPage();
  captain.on("pageerror", (error) => errors.push(error.message));
  await captain.goto(eventUrl);
  await expect(captain.getByAltText(`${title} logo`)).toBeVisible();
  await captain
    .getByRole("button", { name: "Interested", exact: true })
    .click();
  await expect(
    captain.getByRole("button", { name: "Interested", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await captain
    .getByRole("button", { name: `Register ${teamName}`, exact: true })
    .click();
  await expect(
    captain.getByRole("button", { name: `Withdraw ${teamName}`, exact: true }),
  ).toBeVisible();
  await captain.reload();
  await expect(
    captain.getByRole("button", { name: "Interested", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(captain.locator(".event-team-grid")).toContainText(teamName);
  expect(
    (
      await api(leader, `/events/${event.id}/entries/`, "POST", {
        team: team.username,
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await api(
        member,
        `/events/${event.id}/entries/${team.username}/`,
        "DELETE",
      )
    ).status(),
  ).toBe(404);
  await fits(captain);
  await captain.screenshot({
    path: "artifacts/event-signups-desktop.png",
    fullPage: true,
  });
  const mobile = await leader.newPage();
  await mobile.setViewportSize({ width: 393, height: 851 });
  await mobile.goto(eventUrl);
  await expect(
    mobile.getByRole("button", { name: `Withdraw ${teamName}`, exact: true }),
  ).toBeVisible();
  await fits(mobile);
  await mobile.screenshot({
    path: "artifacts/event-signups-mobile.png",
    fullPage: true,
  });
  const anonymous = await browser.newContext();
  expect(
    (await api(anonymous, `/events/${event.id}/interested/`, "POST")).status(),
  ).toBe(403);
  expect(
    (
      await anonymous.request.get(new URL(event.logo_url, origin).href)
    ).status(),
  ).toBe(200);
  await mobile.goto(new URL("/events", origin).href);
  await expect(
    mobile
      .locator(".event-card")
      .filter({ hasText: title })
      .getByRole("button", { name: "Interested", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await fits(mobile);
  const card = mobile.locator(".event-card").filter({ hasText: title });
  await expect(
    card.getByRole("list", { name: "Registered teams", exact: true }),
  ).toContainText(teamName);
  await expect(
    card.getByRole("heading", { name: "Registered teams (1)", exact: true }),
  ).toBeVisible();
  await mobile.screenshot({
    path: "artifacts/event-team-cards-native-mobile.png",
    fullPage: true,
  });
  await captain
    .getByRole("button", { name: `Withdraw ${teamName}`, exact: true })
    .click();
  await expect(
    captain.getByRole("region", { name: "Registered teams", exact: true }),
  ).toContainText("No teams registered yet.");
  expect(
    (await (await api(anonymous, `/events/${event.id}/`)).json()).team_count,
  ).toBe(0);
  await captain
    .getByRole("button", { name: `Register ${teamName}`, exact: true })
    .click();
  await expect(
    captain.getByRole("list", { name: "Registered teams", exact: true }),
  ).toContainText(teamName);
  const publicEvent = (
    await (await api(anonymous, "/events/")).json()
  ).events.find((row) => row.id === event.id);
  expect(publicEvent.team_count).toBe(1);
  expect(publicEvent.teams.map((row) => row.slug)).toEqual([team.username]);
  expect(
    (
      await api(dev, `/dev/events/${event.id}/`, "PATCH", {
        starts_at: new Date(stamp + 2 * 86400000).toISOString(),
      })
    ).status(),
  ).toBe(200);
  await captain.reload();
  await captain
    .getByRole("button", { name: /Event notifications \(1 unread\)/ })
    .click();
  const inbox = captain.getByRole("dialog", { name: "EVENT NOTIFICATIONS" });
  await expect(inbox).toContainText("schedule");
  await inbox
    .getByRole("button", { name: "Mark all read", exact: true })
    .click();
  await expect(
    inbox.getByRole("button", { name: "Mark all read", exact: true }),
  ).toHaveCount(0);
  await inbox
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  expect(
    (
      await api(dev, `/dev/events/${event.id}/`, "PATCH", {
        starts_at: new Date(stamp - 60000).toISOString(),
      })
    ).status(),
  ).toBe(200);
  const notifications = await (
    await api(leader, "/event-notifications/")
  ).json();
  expect(
    notifications.notifications.some((notice) =>
      notice.message.includes("is live"),
    ),
  ).toBe(true);
  expect(
    (await (await api(member, "/event-notifications/")).json()).unread_count,
  ).toBe(0);
  expect(
    (
      await api(
        leader,
        `/events/${event.id}/entries/${team.username}/`,
        "DELETE",
      )
    ).status(),
  ).toBe(409);
  await captain.reload();
  await captain.getByRole("button", { name: /Event notifications/ }).click();
  await captain
    .getByRole("dialog", { name: "EVENT NOTIFICATIONS" })
    .screenshot({ path: "artifacts/event-notifications.png" });
  await fits(captain);
  await mobile.goto(eventUrl);
  await mobile.getByRole("button", { name: /Event notifications/ }).click();
  await mobile
    .getByRole("dialog", { name: "EVENT NOTIFICATIONS" })
    .screenshot({ path: "artifacts/event-notifications-mobile.png" });
  await fits(mobile);
  expect(
    (await api(leader, `/events/${event.id}/interested/`, "DELETE")).status(),
  ).toBe(200);
  const count = notifications.notifications.length;
  expect(
    (
      await api(dev, `/dev/events/${event.id}/`, "PATCH", {
        status: "CANCELLED",
      })
    ).status(),
  ).toBe(200);
  expect(
    (await (await api(leader, "/event-notifications/")).json()).notifications
      .length,
  ).toBe(count);
  await page.reload();
  const row = page
    .locator(".dev-event-list article")
    .filter({ hasText: title });
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  const editing = page.getByRole("dialog", { name: "EDIT EVENT" });
  await editing
    .getByRole("button", { name: "Remove logo", exact: true })
    .click();
  await editing
    .getByRole("button", { name: "Save event", exact: true })
    .click();
  await expect(editing).toHaveCount(0);
  expect(
    (await (await api(anonymous, `/events/${event.id}/`)).json()).logo_url,
  ).toBe("");
  expect(
    (
      await anonymous.request.get(new URL(event.logo_url, origin).href)
    ).status(),
  ).toBe(404);
  expect(errors).toEqual([]);
  console.log(
    "Real event logo upload/removal, team registration, ownership, interest persistence, private notifications, schedule/start alerts, unread state, unsubscribe and mobile layout passed.",
  );
} finally {
  await browser.close();
}
