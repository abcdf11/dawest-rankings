import { test, expect } from "@playwright/test";
test("official team interface uses team API without changing solo ratings", async ({page,request}) => {
  const teams = await (await request.get('http://127.0.0.1:8000/api/v1/teams/rankings/')).json();
  const solo = await (await request.get('http://127.0.0.1:8000/api/v1/rankings/')).json();
  expect(teams.source).toBe('official');
  expect(teams.teams).toHaveLength(teams.total);
  await page.addInitScript(() => sessionStorage.setItem('dawest:intro-seen:v1', '1'));
  await page.goto('http://127.0.0.1:5173/?ranking=teams');
  await expect(page.locator('tbody tr')).toHaveCount(Math.min(10, teams.total));
  if (teams.total < 2) return;
  await page.getByRole('tab',{name:'What-if simulator'}).click();
  const sent = page.waitForResponse(r => r.url().endsWith('/api/v1/teams/simulate/') && r.request().method()==='POST');
  await page.getByRole('button',{name:'Simulate team match'}).click();
  expect((await sent).ok()).toBe(true);
  await expect(page.getByRole('heading',{name:'PROJECTED OUTCOME'})).toBeVisible();
  const after = await (await request.get('http://127.0.0.1:8000/api/v1/rankings/')).json();
  expect(after.players).toEqual(solo.players);
  expect(after.revision).toBe(solo.revision);
});
test("official React interface reads Django and requests a server simulation", async ({
  page,
  request,
}) => {
  const response = await request.get("http://127.0.0.1:8000/api/v1/rankings/");
  expect(response.ok()).toBe(true);
  const ladder = await response.json();
  expect(ladder.source).toBe("official");
  expect(ladder.players).toHaveLength(ladder.total);
  await page.addInitScript(() => sessionStorage.setItem('dawest:intro-seen:v1', '1'));
  await page.goto("http://127.0.0.1:5173/");
  await expect(page.locator("tbody tr")).toHaveCount(Math.min(10, ladder.total));
  await expect(page.locator(".data-note")).toContainText(
    "Only registered player accounts and approved teams appear",
  );
  if (ladder.total < 2) return;
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
