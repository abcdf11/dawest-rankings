import { test, expect } from "@playwright/test";
test("official React interface reads Django and requests a server simulation", async ({
  page,
  request,
}) => {
  const response = await request.get("http://127.0.0.1:8000/api/v1/rankings/");
  expect(response.ok()).toBe(true);
  const ladder = await response.json();
  expect(ladder.source).toBe("official");
  expect(ladder.players).toHaveLength(20);
  await page.goto("http://127.0.0.1:5174/");
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await expect(page.locator(".sync-label")).toContainText("SYNCING");
  await expect(page.locator(".data-note")).toContainText(
    "verified match results",
  );
  await page.getByRole("tab", { name: "What-if simulator" }).click();
  const simulationRequest = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/simulate/") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Simulate duel" }).click();
  const simulation = await simulationRequest;
  expect(simulation.ok()).toBe(true);
  const result = await simulation.json();
  await expect(
    page.getByRole("heading", { name: "PROJECTED OUTCOME" }),
  ).toBeVisible();
  expect(result.delta_a + result.delta_b).toBe(0);
  const after = await (
    await request.get("http://127.0.0.1:8000/api/v1/rankings/")
  ).json();
  expect(after.revision).toBe(ladder.revision);
});
