import { calls, expect, test } from "./fixtures/test";

test.describe("authentication", () => {
  test.describe("signed out", () => {
    test.use({ role: null });

    test("protected pages redirect to login and remember the destination", async ({ page }) => {
      await page.goto("/trips/1");
      await expect(page).toHaveURL(/\/login\?next=%2Ftrips%2F1$/);
      await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
    });

    test.describe("wrong password", () => {
      test.use({ overrides: { "POST /api/auth/login": () => ({ status: 401, body: { error: { message: "Invalid email or password" } } }) } });

      test("shows the server's error and stays on the login page", async ({ page, api }) => {
        await page.goto("/login");
        await page.getByLabel("Email").fill("qa-admin@example.test");
        await page.getByLabel("Password").fill("wrong-password1");
        await page.getByRole("button", { name: "Log in" }).click();
        // (Next.js also renders an empty role="alert" route announcer, so filter by text.)
        await expect(page.getByRole("alert").filter({ hasText: "Invalid email or password" })).toBeVisible();
        await expect(page).toHaveURL(/\/login$/);
        expect(calls(api, "POST", "/api/auth/login")[0].body).toEqual({ email: "qa-admin@example.test", password: "wrong-password1" });
      });
    });
  });

  test("successful login continues to the requested page", async ({ page, api }) => {
    await page.goto("/login?next=/orders");
    await page.getByLabel("Email").fill("qa-admin@example.test");
    await page.getByLabel("Password").fill("Correct-horse1");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();
    expect(calls(api, "POST", "/api/auth/login")).toHaveLength(1);
  });

  test("login ignores off-site redirect targets", async ({ page }) => {
    await page.goto("/login?next=//evil.example");
    await page.getByLabel("Email").fill("qa-admin@example.test");
    await page.getByLabel("Password").fill("Correct-horse1");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("log out from the account menu", async ({ page, api }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /Account menu for QA Admin/ }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(calls(api, "POST", "/api/auth/logout")).toHaveLength(1);
  });
});
