// Real admin controls against an isolated localhost database only.
import { chromium, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
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
    "Admin fixtures require localhost and an isolated database under artifacts/.",
  );
const stamp = Date.now().toString();
const password = `Frontier!${randomBytes(16).toString("hex")}`;
const devUsername = `adev_${stamp}`;
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
      DAWEST_BOOTSTRAP_DEV_USERNAME: devUsername,
      DAWEST_BOOTSTRAP_DEV_PASSWORD: password,
    },
  },
);
if (setup.status !== 0)
  throw new Error("Could not create the isolated admin fixture.");
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
try {
  async function post(context, path, body, status = 200) {
    await context.request.get(new URL("/api/v1/auth/session/", origin).href);
    const csrf = (await context.cookies(origin.origin)).find(
      (cookie) => cookie.name === "csrftoken",
    )?.value;
    const response = await context.request.post(
      new URL(`/api/v1${path}`, origin).href,
      { data: body, headers: { "X-CSRFToken": csrf, Origin: origin.origin } },
    );
    expect(response.status(), `POST ${path}`).toBe(status);
    return response.json();
  }
  async function signup(prefix) {
    const context = await browser.newContext();
    const username = `${prefix}_${stamp}`;
    const result = await post(
      context,
      "/auth/signup/",
      {
        username,
        display_name: username,
        region: "NA",
        password,
        password_confirm: password,
      },
      201,
    );
    return { context, username, id: result.user.player.id };
  }
  const target = await signup("elo");
  const leader = await signup("ldr");
  const wing = await signup("mate");
  const admin = await browser.newContext();
  await post(admin, "/auth/dev-login/", { username: devUsername, password });
  const faction = await post(
    admin,
    "/dev/teams/",
    {
      request_key: randomUUID(),
      team_name: `Admin QA ${stamp}`,
      tag: `A${randomBytes(2).toString("hex").toUpperCase()}`,
      region: "NA",
      captain_username: leader.username,
      members: [leader, wing].map((player) => ({
        username: player.username,
        display_name: player.username,
      })),
    },
    201,
  );
  const page = await admin.newPage();
  await page.goto(new URL("/dev", origin).href);
  await page.getByRole("button", { name: "Elo controls", exact: true }).click();
  await page
    .getByLabel("Player", { exact: true })
    .selectOption(String(target.id));
  await page.getByLabel("Elo change", { exact: true }).fill("25.25");
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Isolated player adjustment verification");
  await page
    .getByRole("button", { name: "Apply Elo change", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("1525.25");
  await page.getByLabel("Ladder", { exact: true }).selectOption("faction");
  await page
    .getByLabel("Faction", { exact: true })
    .selectOption(String(faction.id));
  await page.getByLabel("Elo change", { exact: true }).fill("75");
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Isolated faction adjustment verification");
  await page
    .getByRole("button", { name: "Apply Elo change", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("1575");
  await page.screenshot({
    path: "artifacts/admin-real-elo.png",
    fullPage: true,
  });
  const get = async (path) =>
    (await admin.request.get(new URL(`/api/v1${path}`, origin).href)).json();
  expect((await get(`/players/${target.username}/`)).rating).toBe(1525.25);
  expect((await get(`/teams/${faction.username}/`)).rating).toBe(1575);
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  async function command(text, status = 200) {
    await page.getByLabel("Admin command", { exact: true }).fill(text);
    const pending = page.waitForResponse(
      (response) =>
        response.url().endsWith("/dev/commands/") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    const response = await pending;
    expect(response.status()).toBe(status);
    await expect(
      page.getByLabel("Admin command", { exact: true }),
    ).toBeEnabled();
    return response.json();
  }
  expect((await command("help")).message).toContain("unrestrict <username>");
  expect(
    (await command(`restrict ${target.username} Isolated restriction review`))
      .player.is_restricted,
  ).toBe(true);
  expect(
    (
      await (
        await target.context.request.get(
          new URL("/api/v1/auth/session/", origin).href,
        )
      ).json()
    ).authenticated,
  ).toBe(true);
  expect(
    (await get("/rankings/")).players.some(
      (player) => player.username === target.username,
    ),
  ).toBe(false);
  const profilePage = await target.context.newPage();
  await profilePage.goto(new URL(`/players/${target.username}`, origin).href);
  await expect(
    profilePage.getByText("Restricted account", { exact: true }),
  ).toBeVisible();
  await expect(profilePage.locator(".profile-ranks")).toContainText("Unranked");
  await post(target.context, `/factions/${faction.username}/join/`, {}, 403);
  await command(`unrestrict ${target.username} Isolated review complete`);
  expect(
    (await get("/rankings/")).players.some(
      (player) => player.username === target.username,
    ),
  ).toBe(true);
  await command(`ban ${target.username} Isolated suspension verification`);
  expect(
    (
      await (
        await target.context.request.get(
          new URL("/api/v1/auth/session/", origin).href,
        )
      ).json()
    ).authenticated,
  ).toBe(false);
  await post(
    target.context,
    "/auth/login/",
    { username: target.username, password },
    400,
  );
  await command(`unban ${target.username} Isolated account reinstated`);
  await post(target.context, "/auth/login/", {
    username: target.username,
    password,
  });
  await command("whoami", 400);
  await expect(page.getByRole("log")).toContainText(
    "Unknown command or missing arguments.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/admin-real-terminal-mobile.png",
    fullPage: true,
  });
  const audit = (await get("/dev/dashboard/")).audit;
  for (const action of [
    "player.elo.adjusted",
    "faction.elo.adjusted",
    "player.restrict",
    "player.ban",
    "player.unban",
    "player.unrestrict",
  ])
    expect(audit.some((row) => row.action === action)).toBe(true);
  writeFileSync(
    "artifacts/admin-smoke.json",
    JSON.stringify({
      origin: origin.origin,
      player: target.username,
      player_rating: 1525.25,
      faction: faction.username,
      faction_rating: 1575,
    }),
  );
  console.log(
    "PASS: real developer login; player/faction Elo UI; rank and history updates; restrictions preserve login/profile and block participation; bans revoke sessions and deny login; unban/unrestrict restore access; unknown commands fail; audit records persist. Isolated database only.",
  );
} finally {
  await browser.close();
}
