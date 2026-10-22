import { test, expect } from "@playwright/test";
import { progressReportMetrics } from "../../lib/progress-report-domain";

const userId = "550e8400-e29b-41d4-a716-446655440000";
const dashboard = () => ({
  userId,
  today: "2026-10-22",
  displayName: "Asha",
  email: "asha@example.com",
  recallVisible: false,
  sessions: [] as {
    id: string;
    date: string;
    content: string;
    duration: number;
    status: string;
    submittedAt: string;
  }[],
  sets: [],
  attempts: [],
  dayEntries: [],
  weekly: {
    storageReady: false,
    currentWeekStart: "2026-10-19",
    planPending: false,
    currentGoals: [],
    pendingSummaries: [],
    reports: [],
    voiceNotes: [],
  },
});

test("deployment report is first on home, frozen when new study arrives, and fits mobile", async ({
  page,
}) => {
  const data = {
    ...dashboard(),
    progressReport: {
      releaseId: "2026-10-login-voice-progress-v1",
      cutoffAt: "2026-10-22T06:00:00Z",
      cutoffDate: "2026-10-22",
      generatedAt: "2026-10-22T06:00:00Z",
      metrics: progressReportMetrics(
        {
          sessionCount: 2,
          dailyMinutes: [
            { date: "2026-10-21", minutes: 60 },
            { date: "2026-10-22", minutes: 90 },
          ],
          topicCount: 3,
          subjects: [],
          recallSetCount: 2,
          availableRecallCount: 1,
          recallAttemptCount: 1,
          recallQuestionCount: 10,
          correctAnswerCount: 8,
        },
        "2026-10-22",
      ),
    },
  };
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json:
        path === "/api/status"
          ? { configured: true, authenticated: true }
          : path === "/api/data"
            ? data
            : { ok: true },
    });
  });
  await page.goto("/");
  const report = page.getByRole("region", { name: "The work you’ve put in." });
  await expect(report).toBeVisible();
  await expect(
    page.locator(".topbar + div > .releaseProgress:first-child"),
  ).toHaveCount(1);
  await expect(report.getByText("2h 30m", { exact: true })).toBeVisible();
  await expect(report.getByText("80%", { exact: true })).toBeVisible();
  await expect(report.getByText(/Voice notes are excluded/)).toBeVisible();
  data.sessions = [
    {
      id: userId,
      date: "2026-10-22",
      content: "New work",
      duration: 120,
      status: "ready",
      submittedAt: "2026-10-22T07:00:00Z",
    },
  ];
  await page.reload();
  await expect(report.getByText("2h 30m", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/progress-mobile.png",
    fullPage: true,
  });
});

test("ledger draft and id survive an uncertain save; refresh failure does not turn a saved row into a failed save", async ({
  page,
}) => {
  const requests: Record<string, unknown>[] = [];
  let dataFailure = false;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/status")
      return route.fulfill({ json: { configured: true, authenticated: true } });
    if (path === "/api/data")
      return route.fulfill({
        status: dataFailure ? 503 : 200,
        json: dataFailure ? { error: "Offline" } : dashboard(),
      });
    if (path === "/api/day-entries") {
      requests.push(route.request().postDataJSON());
      if (requests.length === 1)
        return route.fulfill({
          status: 503,
          json: { error: "Connection lost. Try again." },
        });
      dataFailure = true;
      return route.fulfill({ json: { ok: true, duplicate: true } });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await page.getByLabel("SUBJECT", { exact: true }).fill("Math");
  await page.getByLabel("TOPIC", { exact: true }).fill("Fractions");
  await page.getByLabel("EXTRA NOTE").fill("Solved examples");
  await page.getByRole("button", { name: "ADD ROW +" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /Connection lost/ }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("TOPIC", { exact: true })).toHaveValue(
    "Fractions",
  );
  await page.getByRole("button", { name: "ADD ROW +" }).click();
  await expect(page.getByText(/Study row sealed/)).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await expect(page.getByLabel("TOPIC", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("FROM", { exact: true })).toHaveValue("10:00");
});
