import { test, expect, type Page, type Route } from "@playwright/test";

const first = "550e8400-e29b-41d4-a716-446655440101";
const second = "550e8400-e29b-41d4-a716-446655440102";
type Account = { userId: string; name: string } | null;
const accountA = { userId: first, name: "Asha" };
const accountB = { userId: second, name: "Bina" };

async function mockAccount(
  page: Page,
  account: () => Account,
  extra?: (route: Route, path: string) => Promise<boolean>,
) {
  await page.addInitScript(() =>
    sessionStorage.setItem("odhu-indhu-opening-played", "1"),
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (await extra?.(route, path)) return;
    const user = account();
    if (path === "/api/auth/get-session")
      return route.fulfill({
        json: user
          ? {
              session: {
                id: user.userId,
                userId: user.userId,
                expiresAt: "2099-01-01T00:00:00Z",
              },
              user: {
                id: user.userId,
                name: user.name,
                email: `${user.name.toLowerCase()}@example.com`,
                emailVerified: true,
              },
            }
          : null,
      });
    if (path === "/api/status")
      return route.fulfill({
        json: { configured: true, authenticated: Boolean(user) },
      });
    if (path === "/api/data")
      return route.fulfill({
        status: user ? 200 : 401,
        json: user
          ? {
              userId: user.userId,
              today: "2026-10-22",
              displayName: user.name,
              email: `${user.name.toLowerCase()}@example.com`,
              recallVisible: false,
              sessions: [],
              sets: [],
              attempts: [],
              dayEntries: [],
              progressReport: null,
              weekly: {
                storageReady: true,
                currentWeekStart: "2026-10-19",
                planPending: false,
                currentGoals: [],
                pendingSummaries: [],
                reports: [],
                voiceNotes: [],
              },
            }
          : { error: "Unauthorized" },
      });
    return route.fulfill({ json: { ok: true } });
  });
}

test("the mounted login screen opens the ledger when the session changes", async ({
  page,
}) => {
  let current: Account = null;
  await mockAccount(page, () => current);
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: /email/i })).toBeVisible();
  current = accountA;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("WHAT DID YOU STUDY?")).toBeVisible();
  await expect(page.getByText("ASHA’S STUDY COMPANION")).toBeVisible();
});

test("sign-out failures stay visible; successful sign-out clears private drafts and data", async ({
  page,
}) => {
  let current: Account = accountA;
  let fail = true;
  await mockAccount(
    page,
    () => current,
    async (route, path) => {
      if (path !== "/api/auth/sign-out") return false;
      if (fail)
        await route.fulfill({
          status: 503,
          json: { message: "Sign-out service unavailable" },
        });
      else {
        current = null;
        await route.fulfill({ json: { success: true } });
      }
      return true;
    },
  );
  await page.goto("/");
  await page
    .getByLabel("WHAT DID YOU STUDY?")
    .fill("Private unsaved study note");
  await page.evaluate(
    (userId) =>
      sessionStorage.setItem(`odhu-indhu-day-draft:${userId}`, "private draft"),
    first,
  );
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "SIGN OUT", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "Sign-out service unavailable",
  );
  await expect(page.getByLabel("DISPLAY NAME")).toHaveValue("Asha");
  fail = false;
  await page.getByRole("button", { name: "SIGN OUT", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /email/i })).toBeVisible();
  await expect(page.getByText("ASHA’S STUDY COMPANION")).toHaveCount(0);
  expect(
    await page.evaluate(
      (userId) => [
        sessionStorage.getItem(`odhu-indhu-entry-draft:${userId}`),
        sessionStorage.getItem(`odhu-indhu-day-draft:${userId}`),
      ],
      first,
    ),
  ).toEqual([null, null]);
});

test("expiry hides private state and drafts never pass to a different account", async ({
  page,
}) => {
  let current: Account = accountA;
  await mockAccount(page, () => current);
  await page.goto("/");
  await page.getByLabel("WHAT DID YOU STUDY?").fill("Asha's private draft");
  await expect
    .poll(() =>
      page.evaluate(
        (userId) => sessionStorage.getItem(`odhu-indhu-entry-draft:${userId}`),
        first,
      ),
    )
    .toContain("Asha's private draft");
  current = null;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("textbox", { name: /email/i })).toBeVisible();
  await expect(page.getByText("ASHA’S STUDY COMPANION")).toHaveCount(0);
  current = accountB;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("WHAT DID YOU STUDY?")).toHaveValue("");
  await expect(page.getByText("BINA’S STUDY COMPANION")).toBeVisible();
  current = accountA;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("WHAT DID YOU STUDY?")).toHaveValue(
    "Asha's private draft",
  );
});

test("the direct sign-out route retries failures and clears drafts only after success", async ({
  page,
}) => {
  let current: Account = accountA;
  let fail = true;
  await page.addInitScript((userId) => {
    if (sessionStorage.getItem("test-draft-seeded")) return;
    sessionStorage.setItem("test-draft-seeded", "1");
    sessionStorage.setItem(
      `odhu-indhu-entry-draft:${userId}`,
      "private entry draft",
    );
    sessionStorage.setItem(
      `odhu-indhu-day-draft:${userId}`,
      "private day draft",
    );
  }, first);
  await mockAccount(
    page,
    () => current,
    async (route, path) => {
      if (path !== "/api/auth/sign-out") return false;
      if (fail)
        await route.fulfill({
          status: 503,
          json: { message: "Please retry signing out" },
        });
      else {
        current = null;
        await route.fulfill({ json: { success: true } });
      }
      return true;
    },
  );
  await page.goto("/auth/sign-out");
  await expect(page.locator(".authPanel").getByRole("alert")).toHaveText(
    "Please retry signing out",
  );
  expect(
    await page.evaluate(
      (userId) => sessionStorage.getItem(`odhu-indhu-entry-draft:${userId}`),
      first,
    ),
  ).toBe("private entry draft");
  fail = false;
  await page.getByRole("button", { name: "TRY SIGNING OUT AGAIN" }).click();
  await expect(page.getByRole("textbox", { name: /email/i })).toBeVisible();
  expect(
    await page.evaluate(
      (userId) => sessionStorage.getItem(`odhu-indhu-entry-draft:${userId}`),
      first,
    ),
  ).toBeNull();
});

test("a lost save response keeps the same request ID across refresh and retry", async ({
  page,
}) => {
  const ids: string[] = [];
  let fail = true;
  await mockAccount(
    page,
    () => accountA,
    async (route, path) => {
      if (path !== "/api/entries") return false;
      ids.push(route.request().postDataJSON().id);
      if (fail) await route.abort("failed");
      else await route.fulfill({ json: { ok: true } });
      return true;
    },
  );
  await page.goto("/");
  await page.getByLabel("WHAT DID YOU STUDY?").fill("Studied percentages");
  await page.getByRole("button", { name: "SEAL ENTRY ↗" }).click();
  await expect(
    page.getByRole("button", { name: "SEAL ENTRY ↗" }),
  ).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("WHAT DID YOU STUDY?")).toHaveValue(
    "Studied percentages",
  );
  fail = false;
  await page.getByRole("button", { name: "SEAL ENTRY ↗" }).click();
  await expect(
    page.getByText("Entry sealed. A little more knowledge, kept."),
  ).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toEqual(ids[0]);
});

test("a ledger refresh failure cannot turn a successful save into a failed save", async ({
  page,
}) => {
  let saved = false;
  await mockAccount(
    page,
    () => accountA,
    async (route, path) => {
      if (path === "/api/entries") {
        saved = true;
        await route.fulfill({ json: { ok: true } });
        return true;
      }
      if (path === "/api/data" && saved) {
        await route.fulfill({
          status: 503,
          json: { error: "Data temporarily unavailable" },
        });
        return true;
      }
      return false;
    },
  );
  await page.goto("/");
  await page.getByLabel("WHAT DID YOU STUDY?").fill("Studied monsoon patterns");
  await page.getByRole("button", { name: "SEAL ENTRY ↗" }).click();
  await expect(
    page.getByText("Entry sealed. Refresh to update your ledger."),
  ).toBeVisible();
  await expect(page.getByLabel("WHAT DID YOU STUDY?")).toHaveValue("");
});

test("denied browser storage never blocks a study save", async ({ page }) => {
  let writes = 0;
  await mockAccount(
    page,
    () => accountA,
    async (route, path) => {
      if (path !== "/api/entries") return false;
      writes += 1;
      await route.fulfill({ json: { ok: true } });
      return true;
    },
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage is blocked", "SecurityError");
      },
    });
  });
  await page.goto("/");
  await page
    .getByLabel("WHAT DID YOU STUDY?")
    .fill("Studied fundamental rights");
  await page.getByRole("button", { name: "SEAL ENTRY ↗" }).click();
  await expect(
    page.getByText("Entry sealed. A little more knowledge, kept."),
  ).toBeVisible();
  expect(writes).toBe(1);
});

test("account mismatch rejects a stale draft and reopens the current account", async ({
  page,
}) => {
  let current: Account = accountA;
  let expectedAccount: string | undefined;
  await mockAccount(
    page,
    () => current,
    async (route, path) => {
      if (path !== "/api/entries") return false;
      expectedAccount = route.request().headers()["x-account-id"];
      await route.fulfill({
        status: 409,
        json: {
          error: "Your account changed. Reopen your ledger before saving.",
          code: "ACCOUNT_CHANGED",
        },
      });
      return true;
    },
  );
  await page.goto("/");
  await page.getByLabel("WHAT DID YOU STUDY?").fill("Asha's private entry");
  current = accountB;
  await page.getByRole("button", { name: "SEAL ENTRY ↗" }).click();
  await expect(page.getByText("BINA’S STUDY COMPANION")).toBeVisible();
  await expect(page.getByLabel("WHAT DID YOU STUDY?")).toHaveValue("");
  expect(expectedAccount).toBe(first);
});

test("focus revalidation locks private controls while preserving their mounted state", async ({
  page,
}) => {
  let holdStatus = false;
  let pending: Route | null = null;
  await mockAccount(
    page,
    () => accountA,
    async (route, path) => {
      if (path !== "/api/status" || !holdStatus) return false;
      pending = route;
      return true;
    },
  );
  await page.goto("/");
  const field = page.getByLabel("WHAT DID YOU STUDY?");
  await field.fill("Unsaved entry stays mounted");
  await field.evaluate((element) =>
    element.setAttribute("data-preserved", "yes"),
  );
  holdStatus = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect
    .poll(() =>
      field.evaluate((element) => Boolean(element.closest("[inert]"))),
    )
    .toBe(true);
  await expect(field).toHaveAttribute("data-preserved", "yes");
  await pending!.fulfill({ json: { configured: true, authenticated: true } });
  await expect
    .poll(() =>
      field.evaluate((element) => Boolean(element.closest("[inert]"))),
    )
    .toBe(false);
  await expect(field).toHaveValue("Unsaved entry stays mounted");
  await expect(field).toHaveAttribute("data-preserved", "yes");
  await page.getByRole("button", { name: "Open settings" }).click();
  pending = null;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(page.locator("dialog")).toHaveAttribute("inert", "");
  await pending!.fulfill({ json: { configured: true, authenticated: true } });
  await expect(page.locator("dialog")).not.toHaveAttribute("inert", "");
});
