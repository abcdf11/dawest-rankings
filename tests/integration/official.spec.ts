import { test, expect } from "@playwright/test";

for (const kind of ["players", "teams"] as const) {
  test(`official ${kind} rankings read the database without changing ratings`, async ({
    page,
    request,
  }) => {
    const endpoint =
      kind === "teams" ? "/api/v1/teams/rankings/" : "/api/v1/rankings/";
    const before = await (
      await request.get(`http://127.0.0.1:8000${endpoint}`)
    ).json();
    expect(before.source).toBe("official");
    await page.addInitScript(() =>
      sessionStorage.setItem("dawest:intro-seen:v1", "1"),
    );
    await page.goto(`http://127.0.0.1:5173/?ranking=${kind}`);
    await expect(page.locator("tbody tr")).toHaveCount(
      Math.min(10, before.total),
    );
    await expect(
      page.getByRole("tab", { name: "What-if simulator" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: "Community tier list" }),
    ).toHaveCount(0);
    const after = await (
      await request.get(`http://127.0.0.1:8000${endpoint}`)
    ).json();
    expect(after.revision).toBe(before.revision);
    expect(after[kind]).toEqual(before[kind]);
  });
}
