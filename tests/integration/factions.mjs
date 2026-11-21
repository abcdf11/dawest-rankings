// Uses an explicitly isolated local database; all accounts are test fixtures.
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
) {
  throw new Error(
    "Faction fixtures require localhost and an isolated SQLite database under artifacts/.",
  );
}
const suffix = Date.now().toString();
const password = `Frontier!${randomBytes(16).toString("hex")}`;
const devUsername = `fdev_${suffix}`;
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
  throw new Error("Could not create isolated developer fixture.");
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
try {
  async function post(context, path, data, expected = 200) {
    await context.request.get(new URL("/api/v1/auth/session/", origin).href);
    const cookies = await context.cookies(origin.origin);
    const csrf = cookies.find((cookie) => cookie.name === "csrftoken")?.value;
    const response = await context.request.post(
      new URL(`/api/v1${path}`, origin).href,
      { data, headers: { "X-CSRFToken": csrf, Origin: origin.origin } },
    );
    expect(response.status(), `POST ${path}: ${await response.text()}`).toBe(
      expected,
    );
    return response.json();
  }
  async function signup(prefix, displayName) {
    const context = await browser.newContext({
      reducedMotion: "no-preference",
    });
    const username = `${prefix}_${suffix}`;
    await post(
      context,
      "/auth/signup/",
      {
        username,
        display_name: displayName,
        region: "NA",
        password,
        password_confirm: password,
      },
      201,
    );
    return { context, username, displayName };
  }
  const leader = await signup("capt", "Faction Test Leader");
  const wing = await signup("wing", "Faction Test Wing");
  const applicant = await signup("join", "Faction Test Applicant");
  const receipt = await post(
    leader.context,
    "/teams/register/",
    {
      request_key: randomUUID(),
      team_name: `Frontier ${suffix}`,
      tag: `F${randomBytes(2).toString("hex").toUpperCase()}`,
      region: "NA",
      description:
        "A faction created by the real registration and approval workflow.",
      captain_username: leader.username,
      members: [leader, wing].map((player) => ({
        username: player.username,
        display_name: player.displayName,
      })),
    },
    201,
  );
  const dev = await browser.newContext();
  await post(dev, "/auth/dev-login/", { username: devUsername, password });
  const approved = await post(dev, `/dev/registrations/${receipt.id}/review/`, {
    decision: "APPROVED",
    note: "Isolated integration fixture.",
  });
  const username = approved.team_username;
  expect(username).toBeTruthy();
  const leaderPage = await leader.context.newPage();
  await leaderPage.goto(new URL("/faction", origin).href);
  await expect(leaderPage).toHaveURL(
    new URL(`/factions/${username}`, origin).href,
  );
  await leaderPage
    .getByRole("link", { name: "Leader dashboard", exact: true })
    .click();
  await expect(
    leaderPage.getByRole("heading", { name: "No pending requests" }),
  ).toBeVisible();

  const applicantPage = await applicant.context.newPage();
  await applicantPage.goto(new URL(`/factions/${username}`, origin).href);
  await applicantPage
    .getByLabel("Message to leader")
    .fill("Ready to play with this faction.");
  await applicantPage
    .getByRole("button", { name: "Request to join", exact: true })
    .click();
  await expect(
    applicantPage.getByRole("button", {
      name: "Withdraw request",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (
      await applicant.context.request.get(
        new URL(`/api/v1/factions/${username}/manage/`, origin).href,
      )
    ).status(),
  ).toBe(404);
  await leaderPage.reload();
  await expect(leaderPage.locator(".faction-request")).toContainText(
    "Faction Test Applicant",
  );
  await leaderPage
    .getByRole("button", { name: "Accept member", exact: true })
    .click();
  await expect(leaderPage.locator(".faction-request")).toHaveCount(0);
  await expect(leaderPage.locator(".faction-member")).toHaveCount(3);

  await leaderPage
    .getByRole("button", { name: "Customize faction", exact: true })
    .click();
  const dialog = leaderPage.getByRole("dialog", { name: "CUSTOMIZE FACTION" });
  await dialog
    .getByLabel("Faction logo file")
    .setInputFiles(resolve("tests/fixtures/images/profile-avatar-wide.png"));
  await dialog
    .getByLabel("Faction banner file")
    .setInputFiles(
      resolve("tests/fixtures/images/profile-banner-animated.gif"),
    );
  const saved = leaderPage.waitForResponse(
    (response) =>
      response.url().endsWith(`/factions/${username}/appearance/`) &&
      response.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Save images", exact: true })
    .click();
  const result = await saved;
  expect(result.status()).toBe(200);
  const media = await result.json();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() =>
      leaderPage
        .locator(".faction-logo img")
        .evaluate((image) => [image.naturalWidth, image.naturalHeight]),
    )
    .toEqual([256, 256]);
  await expect
    .poll(() =>
      leaderPage
        .locator(".faction-cover img")
        .evaluate((image) => [image.naturalWidth, image.naturalHeight]),
    )
    .toEqual([1280, 240]);
  await applicantPage.goto(new URL("/faction", origin).href);
  await expect(applicantPage).toHaveURL(
    new URL(`/factions/${username}`, origin).href,
  );
  await expect(applicantPage.locator(".faction-member")).toHaveCount(3);
  await expect(
    applicantPage.getByRole("button", {
      name: "Customize faction",
      exact: true,
    }),
  ).toHaveCount(0);
  const ladder = await (
    await applicant.context.request.get(
      new URL("/api/v1/rankings/", origin).href,
    )
  ).json();
  expect(
    ladder.players.find((player) => player.username === applicant.username).team
      .username,
  ).toBe(username);
  await leaderPage.reload();
  await expect(leaderPage.locator(".faction-logo img")).toHaveAttribute(
    "src",
    media.avatar_url,
  );
  await leaderPage.screenshot({
    path: "artifacts/faction-real-leader.png",
    fullPage: true,
  });
  const anonymous = await browser.newPage();
  await anonymous.goto(new URL(`/teams/${username}`, origin).href);
  await expect(anonymous).toHaveURL(
    new URL(`/factions/${username}`, origin).href,
  );
  await expect(
    anonymous.getByRole("link", { name: "Log in to join", exact: true }),
  ).toBeVisible();
  await expect(
    anonymous.getByRole("link", { name: "Leader dashboard", exact: true }),
  ).toHaveCount(0);
  writeFileSync(
    "artifacts/faction-smoke.json",
    JSON.stringify({
      origin: origin.origin,
      username,
      applicant: applicant.username,
      ...media,
    }),
  );
  console.log(
    "PASS: real signup, team registration and developer approval, faction redirects, private leader dashboard, member request and acceptance, leaderboard roster update, fitted logo and GIF banner, reload persistence, and anonymous public profile. Isolated database only.",
  );
} finally {
  await browser.close();
}
