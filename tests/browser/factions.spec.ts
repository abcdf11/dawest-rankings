import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { factionFixture, fixtureApi } from "./fixtures";
import snapshot from "../../frontend/src/data/seed.json";

const faction = factionFixture();
const leader = faction.leader;
const candidate = snapshot.players.find(
  (player) => !faction.members.some((member) => member.id === player.id),
)!;
function session(player = leader) {
  return {
    authenticated: true,
    csrf_token: "test-csrf",
    user: {
      id: player.id,
      username: player.username,
      is_developer: false,
      player: { ...player, is_active: true },
    },
  };
}
const row = {
  id: "request-one",
  status: "PENDING",
  player: candidate,
  faction,
  message: "Ready to make a name together.",
  created_at: "2026-11-21T07:00:00Z",
  reviewed_at: null,
};
test.beforeEach(async ({ page }) => {
  await fixtureApi(page);
});

test("directory searches factions, opens public profiles, and remains responsive", async ({
  page,
}, info) => {
  await page.goto("/factions");
  await expect(
    page.getByRole("heading", { name: "Find your faction." }),
  ).toBeVisible();
  await page.getByLabel("Search factions").fill("BLW");
  await expect(page.locator(".faction-card")).toHaveCount(1);
  await page.locator(".faction-card").click();
  await expect(page).toHaveURL(/\/factions\/blackwater$/);
  await expect(page.locator(".faction-member")).toHaveCount(2);
  await expect(
    page.getByRole("link", { name: "Log in to join", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Leader dashboard", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/faction-profile-${info.project.name}.png`,
    fullPage: true,
  });
});

test("leader dashboard accepts and declines requests and opens image customization", async ({
  page,
}, info) => {
  await page.route("**/api/v1/auth/session/", (route) =>
    route.fulfill({ json: session() }),
  );
  await page.route("**/api/v1/factions/mine/", (route) =>
    route.fulfill({
      json: { owned: [faction], membership: faction, requests: [] },
    }),
  );
  let requests = [
    { ...row },
    {
      ...row,
      id: "request-two",
      player: {
        ...candidate,
        username: "second-player",
        display_name: "Second Player",
      },
    },
  ];
  let members = [...faction.members];
  const decisions: string[] = [];
  await page.route("**/api/v1/factions/blackwater/manage/", (route) =>
    route.fulfill({
      json: {
        faction: { ...faction, members, member_count: members.length },
        requests,
        recent_requests: [],
      },
    }),
  );
  await page.route(
    "**/api/v1/factions/blackwater/requests/*/review/",
    (route) => {
      const decision = route.request().postDataJSON().decision;
      decisions.push(decision);
      const id = new URL(route.request().url()).pathname.split("/").at(-3);
      requests = requests.filter((row) => row.id !== id);
      if (decision === "ACCEPTED")
        members.push({
          ...candidate,
          is_leader: false,
          is_captain: false,
          joined_at: "2026-11-21",
        });
      return route.fulfill({ json: { status: decision } });
    },
  );
  await page.goto("/factions/blackwater/manage");
  await expect(
    page.getByRole("heading", { name: "Member requests" }),
  ).toContainText("2");
  await expect(page.getByText(row.message).first()).toBeVisible();
  await page.screenshot({
    path: `artifacts/faction-leader-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .locator(".faction-request")
    .first()
    .getByRole("button", { name: "Accept member" })
    .click();
  await expect(page.locator(".faction-request")).toHaveCount(1);
  await expect(page.locator(".faction-member")).toHaveCount(3);
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "You're all caught up." }),
  ).toBeVisible();
  expect(decisions).toEqual(["ACCEPTED", "REJECTED"]);
  await page
    .getByRole("button", { name: "Customize faction", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "CUSTOMIZE FACTION" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("faction logo and GIF banner use the faction upload endpoint and persist after reload", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/session/", (route) =>
    route.fulfill({ json: session() }),
  );
  await page.route("**/api/v1/factions/mine/", (route) =>
    route.fulfill({
      json: { owned: [faction], membership: faction, requests: [] },
    }),
  );
  let media = { avatar_url: "", banner_url: "" };
  await page.route("**/api/v1/factions/blackwater/manage/", (route) =>
    route.fulfill({
      json: {
        faction: { ...faction, ...media },
        requests: [],
        recent_requests: [],
      },
    }),
  );
  await page.route("**/api/v1/factions/blackwater/media/**", (route) =>
    route.fulfill({
      contentType: route.request().url().includes("/logo/")
        ? "image/png"
        : "image/gif",
      body: readFileSync(
        resolve(
          `tests/fixtures/images/${route.request().url().includes("/logo/") ? "profile-avatar-wide.png" : "profile-banner-animated.gif"}`,
        ),
      ),
    }),
  );
  await page.route("**/api/v1/factions/blackwater/appearance/", (route) => {
    expect(route.request().headers()["content-type"]).toContain(
      "multipart/form-data; boundary=",
    );
    media = {
      avatar_url: "/api/v1/factions/blackwater/media/logo/fixture/",
      banner_url: "/api/v1/factions/blackwater/media/banner/fixture/",
    };
    return route.fulfill({ json: media });
  });
  await page.goto("/factions/blackwater/manage");
  await page
    .getByRole("button", { name: "Customize faction", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "CUSTOMIZE FACTION" });
  await dialog
    .getByLabel("Faction logo file")
    .setInputFiles(resolve("tests/fixtures/images/profile-avatar-wide.png"));
  await dialog
    .getByLabel("Faction banner file")
    .setInputFiles(
      resolve("tests/fixtures/images/profile-banner-animated.gif"),
    );
  await expect(dialog.getByAltText("Faction logo preview")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Save images", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".faction-logo img")).toHaveAttribute(
    "src",
    media.avatar_url,
  );
  await page.reload();
  await expect(
    page.getByAltText("Blackwater's faction banner"),
  ).toHaveAttribute("src", media.banner_url);
});

test("registered player requests to join, sees pending status, and can withdraw", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/session/", (route) =>
    route.fulfill({ json: session(candidate as typeof leader) }),
  );
  let requests: object[] = [];
  await page.route("**/api/v1/factions/mine/", (route) =>
    route.fulfill({ json: { owned: [], membership: null, requests } }),
  );
  await page.route("**/api/v1/factions/blackwater/join/", (route) => {
    expect(route.request().postDataJSON().message).toBe("Let's play together.");
    requests = [row];
    return route.fulfill({ status: 201, json: row });
  });
  await page.route(
    "**/api/v1/factions/requests/request-one/withdraw/",
    (route) => {
      requests = [];
      return route.fulfill({ json: { ...row, status: "CANCELLED" } });
    },
  );
  await page.goto("/factions/blackwater");
  await page.getByLabel("Message to leader").fill("Let's play together.");
  await page
    .getByRole("button", { name: "Request to join", exact: true })
    .click();
  await expect(
    page.getByText("Your request is awaiting the faction leader's review."),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Withdraw request" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Withdraw request" }).click();
  await expect(
    page.getByRole("button", { name: "Request to join", exact: true }),
  ).toBeVisible();
});

test("my faction and team aliases redirect, and unauthorized dashboard shows an error", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/session/", (route) =>
    route.fulfill({ json: session() }),
  );
  await page.route("**/api/v1/factions/mine/", (route) =>
    route.fulfill({
      json: { owned: [faction], membership: faction, requests: [] },
    }),
  );
  await page.goto("/faction");
  await expect(page).toHaveURL(/\/factions\/blackwater$/);
  await page.goto("/teams/blackwater");
  await expect(page).toHaveURL(/\/factions\/blackwater$/);
  await page.route("**/api/v1/factions/rivals/manage/", (route) =>
    route.fulfill({
      status: 404,
      json: { detail: "You do not lead this faction." },
    }),
  );
  await page.goto("/factions/rivals/manage");
  await expect(
    page.getByRole("heading", { name: "Faction unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Customize faction" }),
  ).toHaveCount(0);
});

test("empty directory and anonymous my faction have clear destinations", async ({
  page,
}) => {
  await page.route("**/api/v1/factions/", (route) =>
    route.fulfill({ json: { factions: [] } }),
  );
  await page.goto("/factions");
  await expect(
    page.getByRole("heading", { name: "The frontier is open." }),
  ).toBeVisible();
  await page.goto("/faction");
  await expect(page).toHaveURL(/\/login\?next=\/faction$/);
});
