import { test, expect } from "@playwright/test";
const id = "550e8400-e29b-41d4-a716-446655440000";
test("Neon Auth offers Google and Magic Link without passwords", async ({ page }) => {
  await page.route("**/api/status", (route) =>
    route.fulfill({ json: { configured: true, authenticated: false } }),
  );
  await page.goto("/auth/sign-in");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Begin with one honest hour." }),
  ).toBeVisible();
  await expect(page.getByText("Sign In", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /email/i })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /google/i })).toBeVisible();
  await expect(page.locator(".authRevealFour")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "test-results/auth.png", fullPage: true });
  await page.evaluate(() =>
    localStorage.setItem("odhu-indhu-has-entered", "1"),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Pick up where you left off." }),
  ).toBeVisible();
});
test("unconfigured app keeps writes closed and presents a calm setup screen", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByText("Preparing your space.")).toBeVisible();
  const r = await request.post("/api/entries", {
    headers: { origin: "http://evil.example" },
    data: {},
  });
  expect(r.status()).toBe(403);
});
test("ledger, history, delayed quizzes and post-submit explanations at desktop and mobile", async ({
  page,
}) => {
  const data = {
    today: "2026-09-13",
    displayName: "Varun",
    sessions: [
      {
        id,
        date: "2026-09-13",
        duration: 60,
        content: "Percentages and successive changes.",
        submittedAt: "2026-09-13T04:00:00Z",
        status: "ready",
      },
    ],
    sets: [
      {
        id,
        topic: "Percentages",
        subject: "Quant",
        studyDate: "2026-09-11",
        availableOn: "2026-09-13",
        count: 1,
        status: "ready",
        locked: false,
      },
      {
        id: "locked",
        topic: "Upcoming recall",
        subject: "",
        studyDate: "2026-09-13",
        availableOn: "2026-09-15",
        count: 10,
        status: "ready",
        locked: true,
      },
    ],
    attempts: [],
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { ok: true };
    if (path === "/api/status")
      body = { configured: true, authenticated: true };
    if (path === "/api/data") body = data;
    if (path === "/api/quiz/start")
      body = {
        id,
        topic: "Percentages",
        questions: [
          { stem: "What is 20% of 100?", options: ["20", "10", "30", "40"] },
        ],
      };
    if (path === "/api/quiz/submit")
      body = {
        score: 1,
        answers: [0],
        questions: [
          {
            stem: "What is 20% of 100?",
            correct: 0,
            solution: "Divide 100 by 100 and multiply by 20.",
            options: ["20", "10", "30", "40"].map((text) => ({
              text,
              explanation:
                text === "20"
                  ? "Twenty is one fifth of one hundred."
                  : "This is not one fifth of one hundred.",
            })),
            sources: ["https://example.org/math"],
          },
        ],
      };
    await route.fulfill({ json: body });
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await expect(page.getByText("✓ DAY COMPLETE")).toBeVisible();
  await page.getByLabel("WHAT DID YOU STUDY?").fill("Indian monsoon patterns");
  await expect(page.getByText("23 / 12,000")).toBeVisible();
  await page.getByRole("button", { name: "90m" }).click();
  await expect(page.getByLabel("TIME SPENT")).toHaveValue("90");
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page.reload();
  await expect(page.getByLabel("WHAT DID YOU STUDY?")).toHaveValue(
    "Indian monsoon patterns",
  );
  await expect(page.getByLabel("TIME SPENT")).toHaveValue("90");
  await page.getByRole("button", { name: "02 / THE LEDGER" }).click();
  await expect(page.getByText("Proof you showed up.")).toBeVisible();
  await page.getByRole("button", { name: "03 / RECALL" }).click();
  await expect(page.getByText("LOCKED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "BEGIN ↗" }).click();
  await expect(
    page.getByText("Twenty is one fifth of one hundred."),
  ).toHaveCount(0);
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "SUBMIT & REVIEW ↗" }).click();
  await expect(
    page.getByText("Twenty is one fifth of one hundred."),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "01 / TODAY" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
