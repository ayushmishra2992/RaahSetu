/**
 * Location picker workflow: search → choose → map pin → save, plus the
 * fallbacks (search not configured, provider errors, manual coordinates) and
 * its reuse from the order and vehicle forms. All /api/places/* calls are
 * answered by fixtures; no location-search provider is contacted.
 */
import type { Page } from "@playwright/test";
import * as F from "./fixtures/data";
import { calls, expect, test } from "./fixtures/test";

async function openAddLocation(page: Page) {
  await page.goto("/locations");
  await page.getByRole("button", { name: "Add location" }).first().click();
  return page.getByRole("dialog", { name: "Add location" });
}

test.describe("location search", () => {
  test("search, choose a suggestion and save with extracted details", async ({ page, api }) => {
    const dialog = await openAddLocation(page);
    const search = dialog.getByRole("combobox", { name: "Search for a place" });
    await search.fill("bhiwandi");
    const list = dialog.getByRole("listbox", { name: "Suggestions" });
    await expect(list.getByRole("group", { name: "Search results" }).getByRole("option")).toHaveCount(2);
    // The company's own "Bhiwandi Depot" is offered first, without a request.
    await expect(list.getByRole("group", { name: "Saved locations" }).getByRole("option")).toHaveText([/Bhiwandi Depot/]);
    await expect(dialog.getByRole("link", { name: "Test search data" })).toBeVisible();
    await list.getByRole("option", { name: /Bhiwandi Logistics Park/ }).click();

    // Name and address are filled; city/state/PIN and coordinates are shown.
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Bhiwandi Logistics Park");
    await expect(dialog.getByLabel("Address", { exact: true })).toHaveValue(/Bhiwandi, Thane, Maharashtra, 421302/);
    await expect(dialog.getByText("City: Bhiwandi · State: Maharashtra · PIN: 421302")).toBeVisible();
    await expect(dialog.getByText("19.281300, 73.048300")).toBeVisible();
    await expect(dialog.getByText("From search")).toBeVisible();
    await expect(dialog.locator(".rs-map-pin")).toBeVisible();
    // City, state and PIN are filled into their own editable fields.
    await expect(dialog.getByLabel("City", { exact: true })).toHaveValue("Bhiwandi");
    await expect(dialog.getByLabel("State / UT")).toHaveValue("Maharashtra");
    await expect(dialog.getByLabel("PIN code")).toHaveValue("421302");

    await dialog.getByLabel("Type").selectOption("WAREHOUSE");
    await dialog.getByRole("button", { name: "Add location" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const [post] = calls(api, "POST", "/api/locations");
    expect(post.body).toMatchObject({
      name: "Bhiwandi Logistics Park",
      type: "WAREHOUSE",
      lat: 19.2813,
      lng: 73.0483,
      city: "Bhiwandi",
      state: "Maharashtra",
      postalCode: "421302",
      country: "India",
      placeProvider: "locationiq",
      providerPlaceId: "p-1",
      coordsSource: "SEARCH",
    });
    expect((post.body as { address: string }).address).toContain("421302");
    // Only the debounced search reached the API (not one call per keystroke).
    expect(calls(api, "GET", "/api/places/autocomplete").length).toBeLessThanOrEqual(2);
  });

  test("keyboard: arrows and Enter choose a suggestion without submitting the form", async ({ page, api }) => {
    const dialog = await openAddLocation(page);
    const search = dialog.getByRole("combobox", { name: "Search for a place" });
    await search.fill("bhiwandi");
    const list = dialog.getByRole("listbox", { name: "Suggestions" });
    await expect(list.getByRole("group", { name: "Search results" }).getByRole("option")).toHaveCount(2);
    await expect(list.getByRole("option", { name: /Bhiwandi Depot/ })).toHaveAttribute("aria-selected", "true");
    await search.press("ArrowDown");
    await search.press("ArrowDown");
    await expect(list.getByRole("option", { name: /Warehouse 7/ })).toHaveAttribute("aria-selected", "true");
    await search.press("Enter");
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Bhiwandi Bypass Warehouse 7");
    await expect(list).toHaveCount(0);
    expect(calls(api, "POST", "/api/locations")).toHaveLength(0);
  });

  test("dragging the pin adjusts the saved coordinates", async ({ page, api }) => {
    const dialog = await openAddLocation(page);
    await dialog.getByRole("combobox", { name: "Search for a place" }).fill("andheri cold");
    await dialog.getByRole("option", { name: /Andheri East Cold Store/ }).click();
    const pin = dialog.locator(".rs-map-pin");
    await expect(pin).toBeVisible();
    const box = (await pin.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 8 });
    await page.mouse.up();
    await expect(dialog.getByText("Pin adjusted")).toBeVisible();
    await expect(dialog.getByText(/moved \d+ m from the search result/)).toBeVisible();
    await dialog.getByRole("button", { name: "Add location" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const body = calls(api, "POST", "/api/locations")[0].body as { lat: number; lng: number; name: string };
    expect(body).toMatchObject({ name: "Andheri East Cold Store", coordsSource: "PIN_ADJUSTED", providerPlaceId: "p-3", postalCode: "400059" });
    expect(body.lat).toBeLessThan(19.1136); // dragged down (south)
    expect(body.lng).toBeGreaterThan(72.8697); // and right (east)
  });

  test("a failed search explains what to do instead", async ({ page }) => {
    test.info().annotations.push({ type: "note", description: "provider rate limit surfaced by the backend" });
    await page.route("**/api/places/autocomplete**", (r) =>
      r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "PLACES_RATE_LIMITED", message: "Location search is busy right now. Try again in a minute, or place the pin on the map." } }) }),
    );
    const dialog = await openAddLocation(page);
    await dialog.getByRole("combobox", { name: "Search for a place" }).fill("mumbai");
    await expect(dialog.getByRole("alert").filter({ hasText: "Location search is busy right now" })).toBeVisible();
  });

  test("no matches suggests alternatives", async ({ page }) => {
    const dialog = await openAddLocation(page);
    await dialog.getByRole("combobox", { name: "Search for a place" }).fill("zzzz nowhere");
    await expect(dialog.getByText(/No matches\. Try another spelling/)).toBeVisible();
  });

  test("manual coordinates are an advanced fallback", async ({ page, api }) => {
    const dialog = await openAddLocation(page);
    const advanced = dialog.locator("details");
    await expect(advanced).not.toHaveAttribute("open", "");
    await dialog.getByText("Advanced: enter coordinates manually").click();
    await dialog.getByLabel("Latitude").fill("19.0760");
    await dialog.getByLabel("Longitude").fill("72.8777");
    await dialog.getByRole("button", { name: "Use coordinates" }).click();
    await expect(dialog.getByText("Coordinates entered")).toBeVisible();
    await dialog.getByLabel("Name", { exact: true }).fill("Gate 3");
    await dialog.getByRole("button", { name: "Add location" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(calls(api, "POST", "/api/locations")[0].body).toMatchObject({ name: "Gate 3", lat: 19.076, lng: 72.8777, address: null, coordsSource: "MANUAL", city: null, placeProvider: null, providerPlaceId: null });
  });

  test("saving without a location asks for one", async ({ page, api }) => {
    const dialog = await openAddLocation(page);
    await dialog.getByLabel("Name", { exact: true }).fill("Somewhere");
    await dialog.getByRole("button", { name: "Add location" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Choose a place, drop a pin on the map, or enter coordinates." }).first()).toBeVisible();
    expect(calls(api, "POST", "/api/locations")).toHaveLength(0);
  });

  test("editing keeps the saved coordinates unless the pin moves", async ({ page, api }) => {
    await page.goto("/locations");
    await page.getByRole("button", { name: /^Edit / }).first().click();
    const dialog = page.getByRole("dialog", { name: /^Edit / });
    await expect(dialog.getByText("Saved location")).toBeVisible();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const [patch] = calls(api, "PATCH", /^\/api\/locations\/\d+$/);
    const body = patch.body as Record<string, unknown>;
    expect(Number.isFinite(body.lat) && Number.isFinite(body.lng)).toBe(true);
    // An unchanged pin leaves the saved provenance alone.
    expect(body).not.toHaveProperty("coordsSource");
    expect(body).not.toHaveProperty("placeProvider");
    expect(calls(api, "GET", "/api/places/autocomplete")).toHaveLength(0);
  });
});

test.describe("provider fallback and limits", () => {
  test("results from the fallback provider carry its attribution and are saved as such", async ({ page, api }) => {
    await page.route("**/api/places/autocomplete**", (r) =>
      r.fulfill({
        json: {
          provider: "geoapify",
          attribution: [{ text: "Powered by Geoapify", url: "https://www.geoapify.com/" }, { text: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" }],
          results: [{ ...F.placeSuggestions[0], providerPlaceId: "g-1" }],
        },
      }),
    );
    const dialog = await openAddLocation(page);
    await dialog.getByRole("combobox", { name: "Search for a place" }).fill("bhiwandi");
    await expect(dialog.getByRole("link", { name: "Powered by Geoapify" })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "© OpenStreetMap contributors" }).first()).toBeVisible();
    await dialog.getByRole("group", { name: "Search results" }).getByRole("option").first().click();
    await dialog.getByRole("button", { name: "Add location" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(calls(api, "POST", "/api/locations")[0].body).toMatchObject({ placeProvider: "geoapify", providerPlaceId: "g-1", coordsSource: "SEARCH" });
  });

  test("the per-company search limit is explained", async ({ page }) => {
    await page.route("**/api/places/autocomplete**", (r) =>
      r.fulfill({ status: 429, json: { error: { code: "PLACES_RATE_LIMITED", message: "Too many location searches from your company in the last minute. Wait a moment and try again." } } }),
    );
    const dialog = await openAddLocation(page);
    await dialog.getByRole("combobox", { name: "Search for a place" }).fill("mumbai");
    await expect(dialog.getByRole("alert").filter({ hasText: "Too many location searches from your company" })).toBeVisible();
    // The map pin remains usable.
    await expect(dialog.getByRole("region", { name: /Location map/ })).toBeVisible();
  });

  test("editing a saved search location shows its details and records a moved pin", async ({ page, api }) => {
    const first = [...F.locations].sort((a, b) => a.name.localeCompare(b.name))[0];
    const saved = { ...first, city: "Mumbai", state: "Maharashtra", postalCode: "400059", country: "India", placeProvider: "locationiq", providerPlaceId: "p-9", coordsSource: "SEARCH" };
    await page.route("**/api/locations", (r) => (r.request().method() === "GET" ? r.fulfill({ json: F.locations.map((l) => (l.id === first.id ? saved : l)) }) : r.fallback()));
    await page.goto("/locations");
    await page.getByRole("button", { name: `Edit ${first.name}` }).click();
    const dialog = page.getByRole("dialog", { name: `Edit ${first.name}` });
    await expect(dialog.getByText("City: Mumbai · State: Maharashtra · PIN: 400059")).toBeVisible();
    await expect(dialog.getByText("Saved location")).toBeVisible();
    const map = dialog.getByRole("region", { name: /Location map/ });
    const box = (await map.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.3);
    await expect(dialog.getByText("Pin adjusted")).toBeVisible();
    await expect(dialog.getByText(/moved .+ from the saved position/)).toBeVisible();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const body = calls(api, "PATCH", `/api/locations/${first.id}`)[0].body as Record<string, unknown>;
    expect(body.coordsSource).toBe("PIN_ADJUSTED");
    // Saved address details are kept, not overwritten: the editable fields go back unchanged.
    expect(body).toMatchObject({ city: "Mumbai", state: "Maharashtra", postalCode: "400059" });
    expect(body).not.toHaveProperty("providerPlaceId");
  });
});

test.describe("location search missing credentials", () => {
  test.use({ overrides: { "GET /api/places/status": { enabled: false, provider: null, attribution: [], reason: "missing_key", minQueryLength: 3 } } });

  test("says the key is missing and keeps the map pin", async ({ page }) => {
    const dialog = await openAddLocation(page);
    await expect(dialog.getByText(/its API key is missing/)).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Search for a place" })).toHaveCount(0);
    await expect(dialog.getByRole("region", { name: /Location map/ })).toBeVisible();
  });
});

test.describe("location search not configured", () => {
  test.use({ overrides: { "GET /api/places/status": { enabled: false, provider: null, attribution: [], reason: "not_configured", minQueryLength: 3 } } });

  test("the map pin still works and no search is attempted", async ({ page, api }) => {
    const dialog = await openAddLocation(page);
    await expect(dialog.getByText("Address search isn’t set up")).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Search for a place" })).toHaveCount(0);
    const map = dialog.getByRole("region", { name: /Location map/ });
    const box = (await map.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4);
    await expect(dialog.getByText("Coordinates entered")).toBeVisible();
    await dialog.getByLabel("Name", { exact: true }).fill("Pinned depot");
    await dialog.getByRole("button", { name: "Add location" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const body = calls(api, "POST", "/api/locations")[0].body as { lat: number; lng: number; coordsSource: string };
    expect(body.coordsSource).toBe("MANUAL");
    expect(body.lat).toBeGreaterThan(-90);
    expect(body.lng).toBeGreaterThan(-180);
    expect(calls(api, "GET", "/api/places/autocomplete")).toHaveLength(0);
  });
});

test.describe("reuse in other forms", () => {
  test("order form: create a pickup location inline and select it", async ({ page, api }) => {
    // After the POST, the location list includes the new location (id 50, as the POST fixture answers).
    let created: Record<string, unknown> | null = null;
    await page.route("**/api/locations", async (route) => {
      const req = route.request();
      if (req.method() === "POST") created = { id: 50, roadNodeId: null, roadNode: null, ...(req.postDataJSON() as object) };
      if (req.method() === "GET" && created) return route.fulfill({ json: [...F.locations, created] });
      await route.fallback();
    });
    await page.goto("/orders?new=1");
    const order = page.getByRole("dialog", { name: "New order" });
    await order.getByRole("button", { name: "New pickup location" }).click();
    const newLoc = page.getByRole("dialog", { name: "New pickup location" });
    await newLoc.getByRole("combobox", { name: "Search for a place" }).fill("bhiwandi park");
    await newLoc.getByRole("option", { name: /Bhiwandi Logistics Park/ }).click();
    await newLoc.getByRole("button", { name: "Add location" }).click();
    await expect(newLoc).toHaveCount(0);
    await expect(order).toBeVisible();
    expect(created).not.toBeNull();
    await expect(order.getByLabel("Pickup")).toHaveValue("50");
    await expect(order.getByLabel("Pickup").locator("option:checked")).toHaveText("Bhiwandi Logistics Park");
    expect(calls(api, "POST", "/api/locations")[0].body).toMatchObject({ name: "Bhiwandi Logistics Park", type: "CUSTOMER", coordsSource: "SEARCH", postalCode: "421302" });
    expect(calls(api, "POST", "/api/orders")).toHaveLength(0);
  });

  test("vehicle form: new depot location defaults to the Depot type", async ({ page, api }) => {
    await page.goto("/vehicles");
    await page.getByRole("button", { name: "Add vehicle" }).first().click();
    await page.getByRole("button", { name: "New depot location" }).click();
    const newLoc = page.getByRole("dialog", { name: "New depot location" });
    await expect(newLoc.getByLabel("Type")).toHaveValue("DEPOT");
    await newLoc.getByRole("combobox", { name: "Search for a place" }).fill("bhiwandi park");
    await newLoc.getByRole("option", { name: /Bhiwandi Logistics Park/ }).click();
    await newLoc.getByRole("button", { name: "Add location" }).click();
    await expect(newLoc).toHaveCount(0);
    expect(calls(api, "POST", "/api/locations")[0].body).toMatchObject({ type: "DEPOT", name: "Bhiwandi Logistics Park", coordsSource: "SEARCH" });
  });

  test.describe("roles without locations:write", () => {
    test.use({ role: "EMPLOYEE" });
    test("do not see the inline new-location buttons", async ({ page }) => {
      await page.goto("/locations");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Add location" })).toHaveCount(0);
    });
  });
});

async function chooseSearchResult(page: Page, query: string, name: RegExp) {
  const dialog = page.getByRole("dialog").last();
  await dialog.getByRole("combobox", { name: "Search for a place" }).fill(query);
  await dialog.getByRole("group", { name: "Search results" }).getByRole("option", { name }).click();
  return dialog;
}

async function dragPin(page: Page, dx: number, dy: number) {
  const pin = page.getByRole("dialog").last().locator(".rs-map-pin");
  const box = (await pin.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
}

const autocompleteCalls = (api: { requests: Array<{ method: string; path: string; query: string }> }, q?: string) =>
  api.requests.filter((r) => r.method === "GET" && r.path === "/api/places/autocomplete" && (q === undefined || new URLSearchParams(r.query).get("q") === q));

test.describe("address data quality", () => {
  test("city, state and PIN are editable, validated and saved as corrected", async ({ page, api }) => {
    await openAddLocation(page);
    const dialog = await chooseSearchResult(page, "bhiwandi park", /Bhiwandi Logistics Park/);
    await dialog.getByLabel("City", { exact: true }).fill("Bhiwandi-Nizampur");
    await dialog.getByLabel("PIN code").fill("42130");
    await dialog.getByRole("button", { name: "Add location" }).click();
    await expect(dialog.getByText("Enter a 6-digit PIN code, e.g. 400059.").first()).toBeVisible();
    expect(calls(api, "POST", "/api/locations")).toHaveLength(0);
    await dialog.getByLabel("PIN code").fill("421 305");
    await dialog.getByLabel("State / UT").selectOption("Maharashtra");
    await dialog.getByRole("button", { name: "Add location" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const body = calls(api, "POST", "/api/locations")[0].body as Record<string, unknown>;
    expect(body).toMatchObject({ city: "Bhiwandi-Nizampur", state: "Maharashtra", postalCode: "421305" });
    // The provider's full address is kept as returned.
    expect(body.address).toBe("Bhiwandi Logistics Park, Mankoli, Bhiwandi, Thane, Maharashtra, 421302, India");
  });

  test("a search result never silently replaces values you typed", async ({ page }) => {
    const dialog = await openAddLocation(page);
    await dialog.getByLabel("Name", { exact: true }).fill("Gate 9");
    await dialog.getByLabel("City", { exact: true }).fill("My City");
    await chooseSearchResult(page, "bhiwandi park", /Bhiwandi Logistics Park/);
    // Empty fields were filled; typed ones were kept and offered in a preview, unticked.
    await expect(dialog.getByLabel("Address", { exact: true })).toHaveValue(/Mankoli/);
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Gate 9");
    await expect(dialog.getByLabel("City", { exact: true })).toHaveValue("My City");
    const preview = dialog.getByRole("region", { name: "Search result details" });
    await expect(preview.getByRole("checkbox", { name: /^City: Bhiwandi/ })).not.toBeChecked();
    await expect(preview.getByRole("checkbox", { name: /^Name: Bhiwandi Logistics Park/ })).not.toBeChecked();
    await expect(preview.getByText(/replaces “My City” \(entered by you\)/)).toBeVisible();
    await preview.getByRole("checkbox", { name: /^City: Bhiwandi/ }).check();
    await preview.getByRole("button", { name: "Apply selected" }).click();
    await expect(dialog.getByLabel("City", { exact: true })).toHaveValue("Bhiwandi");
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Gate 9");
  });
});

test.describe("use pin's address", () => {
  test("previews the address at a moved pin, applies only chosen fields and never moves the pin", async ({ page, api }) => {
    await openAddLocation(page);
    const dialog = await chooseSearchResult(page, "andheri cold", /Andheri East Cold Store/);
    // Not offered until the pin is moved by hand.
    await expect(dialog.getByRole("button", { name: "Use pin’s address" })).toHaveCount(0);
    await dragPin(page, 40, 30);
    await dialog.getByLabel("PIN code").fill("400099"); // typed by hand
    const coords = dialog.getByText(/^\d+\.\d{6}, \d+\.\d{6}/);
    const before = await coords.textContent();
    await dialog.getByRole("button", { name: "Use pin’s address" }).click();

    const preview = dialog.getByRole("region", { name: "Address at the pin" });
    await expect(preview.getByText("Mankoli Naka, Anjur Phata Road, Bhiwandi, Thane, Maharashtra, 421302, India").first()).toBeVisible();
    // Summary of the matched address: city, state and PIN.
    await expect(preview.locator("dl")).toHaveText(/CityBhiwandi\s*State \/ UTMaharashtra\s*PIN421302/);
    await expect(preview.getByText("This address is 22 m from your pin. The pin stays where you put it.")).toBeVisible();
    await expect(preview.getByRole("checkbox", { name: /^Address:/ })).toBeChecked(); // was auto-filled by search
    await expect(preview.getByRole("checkbox", { name: /^City: Bhiwandi/ })).toBeChecked();
    await expect(preview.getByRole("checkbox", { name: /^PIN code: 421302/ })).not.toBeChecked(); // typed by hand
    await expect(preview.getByRole("checkbox", { name: /^Name:/ })).not.toBeChecked();
    // Nothing changes until the user applies.
    await expect(dialog.getByLabel("City", { exact: true })).toHaveValue("Mumbai");
    await preview.getByRole("button", { name: "Apply selected" }).click();
    await expect(dialog.getByText("Address filled in from the pin. The pin was not moved.")).toBeVisible();
    await expect(dialog.getByLabel("Address", { exact: true })).toHaveValue(/^Mankoli Naka/);
    await expect(dialog.getByLabel("City", { exact: true })).toHaveValue("Bhiwandi");
    await expect(dialog.getByLabel("PIN code")).toHaveValue("400099");
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Andheri East Cold Store");
    expect(await coords.textContent()).toBe(before);

    // Asking again for the same pin is answered from memory.
    await dialog.getByRole("button", { name: "Use pin’s address" }).click();
    await expect(dialog.getByRole("region", { name: "Address at the pin" })).toBeVisible();
    expect(calls(api, "GET", "/api/places/reverse")).toHaveLength(1);

    await dialog.getByRole("button", { name: "Keep my values" }).click();
    await dialog.getByRole("button", { name: "Add location" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const body = calls(api, "POST", "/api/locations")[0].body as Record<string, unknown>;
    expect(body).toMatchObject({ city: "Bhiwandi", postalCode: "400099", coordsSource: "PIN_ADJUSTED" });
    expect(body.lat).toBe(Number(before!.split(",")[0]));
  });

  test("shows provider errors and keeps the form usable", async ({ page }) => {
    await page.route("**/api/places/reverse**", (r) => r.fulfill({ status: 503, json: { error: { code: "PLACES_RATE_LIMITED", message: "Location search is busy right now. Try again in a minute, or place the pin on the map." } } }));
    await openAddLocation(page);
    const dialog = await chooseSearchResult(page, "andheri cold", /Andheri East Cold Store/);
    await dragPin(page, 30, 20);
    await dialog.getByRole("button", { name: "Use pin’s address" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Location search is busy right now" })).toBeVisible();
    await expect(dialog.getByRole("region", { name: "Address at the pin" })).toHaveCount(0);
  });

  test("reports when no address is found near the pin", async ({ page }) => {
    await page.route("**/api/places/reverse**", (r) => r.fulfill({ json: { provider: "locationiq", attribution: [], place: null, distanceM: null } }));
    await openAddLocation(page);
    const dialog = await chooseSearchResult(page, "andheri cold", /Andheri East Cold Store/);
    await dragPin(page, 30, 20);
    await dialog.getByRole("button", { name: "Use pin’s address" }).click();
    await expect(dialog.getByText("No address found near the pin. Type the address below.")).toBeVisible();
  });
});

test.describe("search efficiency", () => {
  test("repeated and re-punctuated queries are answered from the dialog's cache", async ({ page, api }) => {
    const dialog = await openAddLocation(page);
    const search = dialog.getByRole("combobox", { name: "Search for a place" });
    const results = dialog.getByRole("group", { name: "Search results" }).getByRole("option");
    await search.fill("bhiwandi");
    await expect(results).toHaveCount(2);
    await search.fill("bhiwandi park");
    await expect(results).toHaveCount(1);
    await search.fill("Bhiwandi ,. ");
    await expect(results).toHaveCount(2);
    await search.fill("  BHIWANDI");
    await expect(results).toHaveCount(2);
    expect(autocompleteCalls(api, "bhiwandi")).toHaveLength(1);
    // The request carries the cleaned-up query.
    expect(autocompleteCalls(api).map((r) => new URLSearchParams(r.query).get("q"))).toEqual(["bhiwandi", "bhiwandi park"]);
  });

  test("extending a query that found nothing sends no request until asked", async ({ page, api }) => {
    const dialog = await openAddLocation(page);
    const search = dialog.getByRole("combobox", { name: "Search for a place" });
    await search.fill("zzzz nowhere");
    await expect(dialog.getByText(/^No matches\. Try another spelling/)).toBeVisible();
    await search.fill("zzzz nowheres");
    await expect(dialog.getByText(/a shorter version of this search found nothing/)).toBeVisible();
    await page.waitForTimeout(700);
    expect(autocompleteCalls(api)).toHaveLength(1);
    await dialog.getByRole("button", { name: "Search anyway" }).click();
    await expect.poll(() => autocompleteCalls(api).length).toBe(2);
    expect(autocompleteCalls(api, "zzzz nowheres")).toHaveLength(1);
  });

  test("broaden search only runs when the user picks it", async ({ page, api }) => {
    const dialog = await openAddLocation(page);
    await dialog.getByRole("combobox", { name: "Search for a place" }).fill("Amazon fulfillment center Bhiwandi");
    const broaden = dialog.getByRole("button", { name: "Broaden search: “Amazon Bhiwandi”" });
    await expect(broaden).toBeVisible();
    await page.waitForTimeout(700);
    expect(autocompleteCalls(api)).toHaveLength(1); // no automatic retries after zero results
    await broaden.click();
    await expect(dialog.getByRole("combobox", { name: "Search for a place" })).toHaveValue("Amazon Bhiwandi");
    await dialog.getByRole("button", { name: "Broaden search: “Bhiwandi”" }).click();
    await expect(dialog.getByRole("group", { name: "Search results" }).getByRole("option")).toHaveCount(2);
    expect(autocompleteCalls(api).map((r) => new URLSearchParams(r.query).get("q"))).toEqual(["Amazon fulfillment center Bhiwandi", "Amazon Bhiwandi", "Bhiwandi"]);
  });
});

test.describe("saved locations and duplicates", () => {
  test("order form: picking a saved location reuses it instead of creating one", async ({ page, api }) => {
    await page.goto("/orders?new=1");
    const order = page.getByRole("dialog", { name: "New order" });
    await order.getByRole("button", { name: "New pickup location" }).click();
    const newLoc = page.getByRole("dialog", { name: "New pickup location" });
    await newLoc.getByRole("combobox", { name: "Search for a place" }).fill("vashi");
    await newLoc.getByRole("group", { name: "Saved locations" }).getByRole("option", { name: /Vashi Warehouse/ }).click();
    await expect(newLoc).toHaveCount(0);
    await expect(order.getByLabel("Pickup")).toHaveValue("2");
    expect(calls(api, "POST", "/api/locations")).toHaveLength(0);
  });

  test("vehicle form: a pin on top of an existing location offers to use it", async ({ page, api }) => {
    await page.goto("/vehicles");
    await page.getByRole("button", { name: "Add vehicle" }).first().click();
    await page.getByRole("button", { name: "New depot location" }).click();
    const newLoc = page.getByRole("dialog", { name: "New depot location" });
    await newLoc.getByText("Advanced: enter coordinates manually").click();
    await newLoc.getByLabel("Latitude").fill("19.2968");
    await newLoc.getByLabel("Longitude").fill("73.0632");
    await newLoc.getByRole("button", { name: "Use coordinates" }).click();
    await newLoc.getByLabel("Name", { exact: true }).fill("Main depot");
    await newLoc.getByRole("button", { name: "Add location" }).click();
    await expect(newLoc.getByText("This may already be saved")).toBeVisible();
    expect(calls(api, "POST", "/api/locations")).toHaveLength(0);
    await newLoc.getByRole("button", { name: "Use this location" }).click();
    await expect(newLoc).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: /vehicle/i }).getByLabel("Home depot")).toHaveValue("1");
  });

  test("Locations page: duplicate warning, then edit the existing one instead", async ({ page, api }) => {
    await openAddLocation(page);
    const dialog = await chooseSearchResult(page, "andheri cold", /Andheri East Cold Store/); // same spot as "Andheri Customer"
    await dialog.getByRole("button", { name: "Add location" }).click();
    const warning = dialog.getByRole("status").filter({ hasText: "This may already be saved" });
    await expect(warning).toContainText("Andheri Customer");
    await expect(warning).toContainText("0 m away");
    expect(calls(api, "POST", "/api/locations")).toHaveLength(0);
    await warning.getByRole("button", { name: "Edit it instead" }).click();
    await expect(page.getByRole("dialog", { name: "Edit Andheri Customer" })).toBeVisible();
  });

  test("Locations page: a genuine second location can still be saved", async ({ page, api }) => {
    await openAddLocation(page);
    const dialog = await chooseSearchResult(page, "andheri cold", /Andheri East Cold Store/);
    await dialog.getByRole("button", { name: "Add location" }).click();
    await dialog.getByRole("button", { name: "Save as a new location anyway" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(calls(api, "POST", "/api/locations")).toHaveLength(1);
  });

  test("Locations page: choosing a saved location from the search warns instead of duplicating", async ({ page, api }) => {
    const dialog = await openAddLocation(page);
    await dialog.getByRole("combobox", { name: "Search for a place" }).fill("kurla");
    await dialog.getByRole("group", { name: "Saved locations" }).getByRole("option", { name: /Kurla Yard/ }).click();
    await expect(dialog.getByText("Already saved")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Edit it instead" })).toBeVisible();
    expect(calls(api, "POST", "/api/locations")).toHaveLength(0);
  });

  test("a location far from any existing one is saved without a warning", async ({ page, api }) => {
    await openAddLocation(page);
    const dialog = await chooseSearchResult(page, "bhiwandi park", /Bhiwandi Logistics Park/); // ~2 km from Bhiwandi Depot
    await dialog.getByRole("button", { name: "Add location" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(calls(api, "POST", "/api/locations")).toHaveLength(1);
  });
});

test.describe("location dialog layout", () => {
  for (const [w, h] of [[390, 844], [768, 1024], [1440, 900]] as const) {
    test(`fits without sideways scrolling at ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openAddLocation(page);
      const dialog = await chooseSearchResult(page, "andheri cold", /Andheri East Cold Store/);
      await dragPin(page, 30, 20);
      await dialog.getByRole("button", { name: "Use pin’s address" }).click();
      await expect(dialog.getByRole("region", { name: "Address at the pin" })).toBeVisible();
      const overflow = await page.evaluate(() => {
        const d = document.querySelector("dialog[open] [data-dialog-body]") as HTMLElement | null;
        return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, dialog: d ? d.scrollWidth - d.clientWidth : -1 };
      });
      expect(overflow.page).toBeLessThanOrEqual(0);
      expect(overflow.dialog).toBeLessThanOrEqual(0);
      if (process.env.SHOT_OUT) {
        await dialog.getByRole("region", { name: "Address at the pin" }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${process.env.SHOT_OUT}/location-dialog-${w}.png` });
      }
    });
  }
});
