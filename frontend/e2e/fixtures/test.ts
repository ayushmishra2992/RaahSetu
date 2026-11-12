/**
 * Shared Playwright fixture: every test gets a mocked API (signed in as ADMIN
 * unless `role` is overridden) and fails if the page throws an uncaught error
 * or calls an /api endpoint that has no fixture.
 */
import { test as base, expect } from "@playwright/test";
import type { Role } from "./data";
import { mockApi, type MockOptions, type RecordedRequest } from "./mock-api";

interface Fixtures {
  role: Role | null;
  overrides: MockOptions["overrides"];
  api: { requests: RecordedRequest[]; unmocked: string[] };
  pageErrors: string[];
}

export const test = base.extend<Fixtures>({
  role: ["ADMIN", { option: true }],
  overrides: [undefined, { option: true }],
  pageErrors: async ({ page }, provide) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await provide(errors);
  },
  api: [
    async ({ page, role, overrides, pageErrors }, provide) => {
      const api = await mockApi(page, { role, overrides });
      await provide(api);
      expect(pageErrors, "uncaught page errors").toEqual([]);
      expect(api.unmocked, "API calls without fixtures").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Requests matching a method and path (exact, or a RegExp). */
export function calls(api: { requests: RecordedRequest[] }, method: string, path: string | RegExp) {
  return api.requests.filter((r) => r.method === method && (typeof path === "string" ? r.path === path : path.test(r.path)));
}
