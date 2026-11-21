import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/session/", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        user: {
          id: 31,
          username: "captain_new",
          is_developer: false,
          player: {
            id: 31,
            username: "captain_new",
            display_name: "captain_new",
            region: "NA",
            rating: 1500,
            rank: 1,
            is_active: true,
          },
        },
        csrf_token: "test",
      },
    }),
  );
});

const id = "c4b26b63-ef02-4b51-bc94-f577291590fb";
const receipt = {
  id,
  reference: "DW-C4B26B63EF",
  team_name: "New Frontier",
  tag: "NFR",
  region: "NA",
  status: "PENDING",
  created_at: "2026-11-21T00:00:00Z",
  reviewed_at: null,
  review_note: "",
  team_username: null,
};
async function fillForm(page: import("@playwright/test").Page) {
  await page.getByLabel("Team name", { exact: true }).fill("New Frontier");
  await page.getByLabel("Team tag", { exact: true }).fill("nfr");
  await expect(
    page.getByLabel("Captain username", { exact: true }),
  ).toHaveValue("captain_new");
  await expect(page.getByLabel("Contact email", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByLabel("Player 2 username", { exact: true })
    .fill("teammate_new");
}

test("separate registration page submits a roster and saves a reloadable receipt", async ({
  page,
}, testInfo) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/v1/teams/register/", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: receipt });
  });
  await page.route(`**/api/v1/teams/registrations/${id}/`, (route) =>
    route.fulfill({ json: receipt }),
  );
  await page.goto("/register");
  await expect(
    page.getByRole("heading", { name: "REGISTER A TEAM", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".intro-screen")).toHaveCount(0);
  await fillForm(page);
  await page.getByRole("button", { name: "Add a player" }).click();
  await expect(
    page.getByLabel("Player 3 username", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove player 3" }).click();
  await expect(
    page.getByLabel("Player 3 username", { exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/registration-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Submit team registration" }).click();
  await expect(
    page.getByRole("heading", { name: "REGISTRATION RECEIVED." }),
  ).toBeVisible();
  expect(submitted?.tag).toBe("NFR");
  expect(submitted?.members).toEqual([
    { username: "captain_new", display_name: "captain_new" },
    { username: "teammate_new", display_name: "teammate_new" },
  ]);
  expect(submitted?.request_key).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page).toHaveURL(new RegExp(`/register\\?receipt=${id}`));
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "REGISTRATION RECEIVED." }),
  ).toBeVisible();
  await expect(page.locator(".receipt-details")).toContainText("DW-C4B26B63EF");
});

test("registration conflicts preserve the form and a receipt can show approval", async ({
  page,
}) => {
  await page.route("**/api/v1/teams/register/", (route) =>
    route.fulfill({
      status: 409,
      json: {
        detail: "That team tag is already registered or awaiting review.",
      },
    }),
  );
  await page.goto("/register");
  await fillForm(page);
  await page.getByRole("button", { name: "Submit team registration" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "That team tag is already registered",
  );
  await expect(page.getByLabel("Team name", { exact: true })).toHaveValue(
    "New Frontier",
  );
  await page.route(`**/api/v1/teams/registrations/${id}/`, (route) =>
    route.fulfill({
      json: {
        ...receipt,
        status: "APPROVED",
        team_username: "new-frontier-c4b26b63",
        review_note: "Verified roster",
      },
    }),
  );
  await page.goto(`/register?receipt=${id}`);
  await expect(
    page.getByRole("heading", { name: "WELCOME TO THE CIRCUIT." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View faction profile" }),
  ).toHaveAttribute("href", "/factions/new-frontier-c4b26b63");
});
