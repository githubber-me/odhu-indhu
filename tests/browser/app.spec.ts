import { test, expect } from "@playwright/test";
const id = "550e8400-e29b-41d4-a716-446655440000";
test("social previews expose public Open Graph and X cards", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Odhu Indhu | One hour. Every day.",
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  for (const path of ["/opengraph-image", "/twitter-image"]) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
    expect((await response.body()).length).toBeGreaterThan(100_000);
  }
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).name).toBe("Odhu Indhu");
  const home = await request.get("/");
  expect(home.headers()["permissions-policy"]).toContain("microphone=(self)");
  expect(home.headers()["permissions-policy"]).not.toContain("microphone=()");
  expect(home.headers()["content-security-policy"]).toContain("media-src 'self' blob:");
});
test("Neon Auth offers Google and Magic Link without passwords", async ({ page }) => {
  await page.route("**/api/status", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.fulfill({ json: { configured: true, authenticated: false } });
  });
  await page.goto("/auth/sign-in");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("status")).toHaveText("Opening your ledger…");
  await expect(page.locator(".openingFrame")).toHaveCount(4);
  await expect(page.getByText("A quiet place")).toHaveCount(0);
  await page.waitForTimeout(900);
  await page.screenshot({ path: "test-results/opening.png", fullPage: true });
  await expect(
    page.getByRole("heading", { name: "baa appi, odhi nodu." }),
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
test("Recall stays hidden until study has been logged on two IST days", async ({
  page,
}) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/status")
      return route.fulfill({
        json: { configured: true, authenticated: true },
      });
    if (path === "/api/data")
      return route.fulfill({
        json: {
          today: "2026-09-13",
          displayName: "Varun",
          recallVisible: false,
          sessions: [
            {
              id,
              date: "2026-09-13",
              duration: 60,
              content: "Karnataka current affairs.",
              submittedAt: "2026-09-13T04:00:00Z",
              status: "ready",
            },
          ],
          // Even stale client data must not reveal the Recall interface.
          sets: [
            {
              id,
              topic: "Hidden topic",
              subject: "Current affairs",
              studyDate: "2026-09-13",
              availableOn: "2026-09-15",
              count: 10,
              status: "ready",
              locked: true,
            },
          ],
          attempts: [],
          weekly: {
            storageReady: true,
            currentWeekStart: "2026-09-07",
            planPending: false,
            currentGoals: [],
            pendingSummaries: [],
            reports: [],
            voiceNotes: [],
          },
        },
      });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /TODAY/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /RECALL/ })).toHaveCount(0);
  await expect(page.getByText("TOPICS TO RECALL")).toHaveCount(0);
  await expect(page.getByText("Hidden topic")).toHaveCount(0);
});
test("weekly report and voice rituals lead the signed-in mobile view", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const mediaStream = {
      getTracks: () => [{ stop: () => undefined }],
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => mediaStream },
    });
    class MockMediaRecorder {
      static isTypeSupported(type: string) {
        return type === "audio/wav";
      }
      state: RecordingState = "inactive";
      mimeType = "audio/wav";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        const sampleRate = 8_000;
        const samples = sampleRate;
        const buffer = new ArrayBuffer(44 + samples);
        const view = new DataView(buffer);
        const write = (offset: number, value: string) =>
          [...value].forEach((character, index) =>
            view.setUint8(offset + index, character.charCodeAt(0)),
          );
        write(0, "RIFF");
        view.setUint32(4, 36 + samples, true);
        write(8, "WAVE");
        write(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate, true);
        view.setUint16(32, 1, true);
        view.setUint16(34, 8, true);
        write(36, "data");
        view.setUint32(40, samples, true);
        new Uint8Array(buffer, 44).fill(128);
        this.ondataavailable?.({
          data: new Blob([buffer], { type: this.mimeType }),
        } as BlobEvent);
        this.onstop?.();
      }
    }
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: MockMediaRecorder,
    });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/status")
      return route.fulfill({
        json: { configured: true, authenticated: true },
      });
    if (path === "/api/data")
      return route.fulfill({
        json: {
          today: "2026-09-13",
          displayName: "Student",
          email: "student@example.com",
          recallVisible: false,
          sessions: [],
          sets: [],
          attempts: [],
          weekly: {
            storageReady: true,
            currentWeekStart: "2026-09-07",
            planPending: true,
            currentGoals: [],
            pendingSummaries: ["2026-09-07"],
            reports: [
              {
                id,
                weekStart: "2026-08-31",
                generatedAt: "2026-09-07T00:00:00+05:30",
                downloadedAt: null,
              },
            ],
            voiceNotes: [
              {
                id: "550e8400-e29b-41d4-a716-446655440002",
                weekStart: "2026-08-31",
                kind: "reflection",
                uploadedAt: "2026-09-06T12:00:00Z",
              },
            ],
          },
        },
      });
    return route.fulfill({ json: { ok: true } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const priority = page.getByLabel("Weekly priorities");
  await expect(priority.getByText("YOUR WEEKLY LEDGER IS READY")).toBeVisible();
  await expect(priority.getByText("CLOSE THE WEEK")).toBeVisible();
  await expect(priority.getByText("THIS WEEK’S INTENTION")).toBeVisible();
  const intention = priority.locator(".weeklyVoiceAction").filter({
    hasText: "THIS WEEK’S INTENTION",
  });
  await intention.getByRole("button", { name: "RECORD" }).click();
  await expect(intention.getByRole("button", { name: /STOP 0:00/ })).toBeVisible();
  await intention.getByRole("button", { name: /STOP/ }).click();
  await expect(intention.getByRole("button", { name: /SEAL VOICE NOTE/ })).toBeVisible();
  await expect(intention.getByText(/0:01/)).toBeVisible();
  await expect(intention.locator("audio")).toHaveCount(1);
  const playback = await intention.locator("audio").evaluate(async (element) => {
    const audio = element as HTMLAudioElement;
    audio.muted = true;
    await audio.play();
    const state = { paused: audio.paused, duration: audio.duration };
    audio.pause();
    return state;
  });
  expect(playback.paused).toBe(false);
  expect(playback.duration).toBeGreaterThan(0);
  await expect(page.locator(".weeklyPriority + .hero")).toHaveCount(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({ path: "test-results/weekly-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByLabel("DISPLAY NAME")).toHaveValue("Student");
  await expect(page.getByText("student@example.com")).toBeVisible();
  await expect(page.getByText("WEEKLY PDF")).toBeVisible();
  await expect(page.getByText("WEEKLY REFLECTION")).toBeVisible();
  await expect(page.locator(".weeklyArchive audio")).toHaveCount(1);
});
test("ledger, history, delayed quizzes and post-submit explanations at desktop and mobile", async ({
  page,
}) => {
  const data = {
    today: "2026-09-13",
    displayName: "Varun",
    recallVisible: true,
    sessions: [
      {
        id,
        date: "2026-09-13",
        duration: 60,
        content: "Percentages and successive changes.",
        submittedAt: "2026-09-13T04:00:00Z",
        status: "ready",
      },
      {
        id: "550e8400-e29b-41d4-a716-446655440001",
        date: "2026-09-12",
        duration: 45,
        content: "Indian monsoon patterns.",
        submittedAt: "2026-09-12T04:00:00Z",
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
    weekly: {
      storageReady: true,
      currentWeekStart: "2026-09-07",
      planPending: false,
      currentGoals: [
        {
          title: "Finish types of Indian soils and revise maps",
          category: "Indian Geography",
          target: "Three focused sessions",
        },
        {
          title: "Cover Karnataka current affairs",
          category: "Current Affairs",
          target: "Four short reviews",
        },
      ],
      pendingSummaries: [],
      reports: [],
      voiceNotes: [],
    },
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
  const weeklyGoals = page.locator("details.weeklyGoals");
  await expect(weeklyGoals).toBeVisible();
  await expect(weeklyGoals).not.toHaveAttribute("open", "");
  await expect(weeklyGoals.getByText("Finish types of Indian soils and revise maps")).toBeHidden();
  await weeklyGoals.locator("summary").click();
  await expect(weeklyGoals.getByText("Finish types of Indian soils and revise maps")).toBeVisible();
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
  await weeklyGoals.locator("summary").click();
  await expect(weeklyGoals.getByText("Finish types of Indian soils and revise maps")).toBeVisible();
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
