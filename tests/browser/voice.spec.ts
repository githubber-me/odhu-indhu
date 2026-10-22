import { expect, test, type Page } from "@playwright/test";

const userId = "550e8400-e29b-41d4-a716-446655440010";
const noteId = "550e8400-e29b-41d4-a716-446655440011";

function dashboard() {
  return {
    userId,
    today: "2026-10-22",
    displayName: "Student",
    email: "student@example.com",
    recallVisible: false,
    sessions: [],
    sets: [],
    attempts: [],
    dayEntries: [],
    progressReport: null,
    weekly: {
      storageReady: true,
      processingReady: true,
      uploadPrefix: `weekly/${userId}`,
      currentWeekStart: "2026-10-19",
      planPending: true,
      currentGoals: [],
      pendingSummaries: [],
      reports: [],
      voiceNotes: [] as {
        id: string;
        weekStart: string;
        kind: string;
        status: string;
        uploadedAt: string;
      }[],
    },
  };
}

async function mockMicrophone(page: Page, denied = false) {
  await page.addInitScript(
    ({ denied }) => {
      sessionStorage.setItem("odhu-indhu-opening-played", "1");
      const counters = window as unknown as { voiceTrackStops: number };
      counters.voiceTrackStops = 0;
      const tracks = [
        {
          stop: () => {
            counters.voiceTrackStops++;
          },
        },
      ];
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            if (denied)
              throw new DOMException("Permission denied", "NotAllowedError");
            return { getTracks: () => tracks };
          },
        },
      });
      class Recorder {
        static isTypeSupported() {
          return false;
        }
        state = "inactive";
        mimeType = "audio/wav";
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        start() {
          this.state = "recording";
        }
        stop() {
          this.state = "inactive";
          const data = new ArrayBuffer(8044);
          const view = new DataView(data);
          const text = (offset: number, value: string) =>
            [...value].forEach((character, index) =>
              view.setUint8(offset + index, character.charCodeAt(0)),
            );
          text(0, "RIFF");
          view.setUint32(4, 8036, true);
          text(8, "WAVE");
          text(12, "fmt ");
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true);
          view.setUint16(22, 1, true);
          view.setUint32(24, 8000, true);
          view.setUint32(28, 8000, true);
          view.setUint16(32, 1, true);
          view.setUint16(34, 8, true);
          text(36, "data");
          view.setUint32(40, 8000, true);
          new Uint8Array(data, 44).fill(128);
          this.ondataavailable?.({
            data: new Blob([data], { type: this.mimeType }),
          });
          this.onstop?.();
        }
      }
      Object.defineProperty(window, "MediaRecorder", {
        configurable: true,
        value: Recorder,
      });
    },
    { denied },
  );
}

test("a recorded note retries final save without uploading audio twice", async ({
  page,
}) => {
  await mockMicrophone(page);
  const data = dashboard();
  let tokenRequests = 0;
  let audioUploads = 0;
  const completed: { noteId: string; pathname: string; url: string }[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "vercel.com") {
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "PUT, OPTIONS",
      };
      if (route.request().method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      audioUploads++;
      const pathname = url.searchParams.get("pathname")!;
      expect(pathname).toMatch(
        new RegExp(`^weekly/${userId}/[a-z0-9-]+/plan-2026-10-19\\.wav$`),
      );
      return route.fulfill({
        headers,
        json: {
          pathname,
          url: `https://test.private.blob.vercel-storage.com/${pathname}`,
          downloadUrl: `https://test.private.blob.vercel-storage.com/${pathname}`,
          contentType: "audio/wav",
          contentDisposition: "attachment",
        },
      });
    }
    if (url.pathname === "/api/status")
      return route.fulfill({ json: { configured: true, authenticated: true } });
    if (url.pathname === "/api/data") return route.fulfill({ json: data });
    if (url.pathname === "/api/weekly/upload") {
      expect(route.request().headers()["x-account-id"]).toBe(userId);
      tokenRequests++;
      return route.fulfill({
        json: {
          type: "blob.generate-client-token",
          clientToken: "vercel_blob_client_test_test",
        },
      });
    }
    if (url.pathname === "/api/weekly/complete") {
      expect(route.request().headers()["x-account-id"]).toBe(userId);
      completed.push(route.request().postDataJSON());
      if (completed.length === 1)
        return route.fulfill({
          status: 503,
          json: { error: "Connection interrupted. Retry this save." },
        });
      data.weekly.planPending = false;
      data.weekly.voiceNotes = [
        {
          id: completed[1].noteId,
          weekStart: "2026-10-19",
          kind: "plan",
          status: "queued",
          uploadedAt: "2026-10-22T00:00:00Z",
        },
      ];
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { ok: true } });
  });
  const response = await page.goto("/");
  expect(response!.headers()["content-security-policy"]).toContain(
    "https://vercel.com/api/blob/",
  );
  const voice = page.locator(".weeklyVoiceAction");
  await voice.getByRole("button", { name: "RECORD", exact: true }).click();
  await voice.getByRole("button", { name: /STOP/ }).click();
  await expect(voice.locator("audio")).toHaveCount(1);
  await voice.getByRole("button", { name: /SEAL VOICE NOTE/ }).click();
  await expect(
    page.getByText("Connection interrupted. Retry this save.", { exact: true }),
  ).toBeVisible();
  await voice.getByRole("button", { name: /RETRY SAVE/ }).click();
  await expect(
    page.getByRole("heading", { name: "Your voice note is being prepared." }),
  ).toBeVisible();
  expect(tokenRequests).toBe(1);
  expect(audioUploads).toBe(1);
  expect(completed).toHaveLength(2);
  expect(completed[1]).toEqual(completed[0]);
});

test("microphone permission denial leaves audio-file input available", async ({
  page,
}) => {
  await mockMicrophone(page, true);
  const data = dashboard();
  await page.route("**/api/**", async (route) => {
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
  const voice = page.locator(".weeklyVoiceAction");
  await voice.getByRole("button", { name: "RECORD", exact: true }).click();
  await expect(
    page.getByText(/Microphone permission is blocked/),
  ).toBeVisible();
  await voice
    .locator('input[type="file"]')
    .setInputFiles({
      name: "voice.flac",
      mimeType: "",
      buffer: Buffer.from("fLaCaudio"),
    });
  await expect(
    voice.getByRole("button", { name: /SEAL VOICE NOTE/ }),
  ).toBeEnabled();
  await expect(voice.getByText("voice.flac", { exact: true })).toBeVisible();
});

test("a failed transcript retries the saved recording and shows processing status", async ({
  page,
}) => {
  const data = dashboard();
  data.weekly.planPending = false;
  data.weekly.voiceNotes = [
    {
      id: noteId,
      weekStart: "2026-10-19",
      kind: "plan",
      status: "failed",
      uploadedAt: "2026-10-22T00:00:00Z",
    },
  ];
  let retryRequests = 0;
  await page.addInitScript(() =>
    sessionStorage.setItem("odhu-indhu-opening-played", "1"),
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/status")
      return route.fulfill({ json: { configured: true, authenticated: true } });
    if (path === "/api/data") return route.fulfill({ json: data });
    if (path === "/api/weekly/retry") {
      expect(route.request().headers()["x-account-id"]).toBe(userId);
      retryRequests++;
      expect(route.request().postDataJSON()).toEqual({ id: noteId });
      data.weekly.voiceNotes[0].status = "transcribing";
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Your recording is safe. Processing needs another try.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /RETRY PROCESSING/ }).click();
  await expect(
    page.getByRole("heading", { name: "Your voice note is being prepared." }),
  ).toBeVisible();
  expect(retryRequests).toBe(1);
  await expect(page.locator(".weeklyVoiceAction")).toHaveCount(0);
});

test("focus and visibility checks preserve an active recording for the same account", async ({
  page,
}) => {
  await mockMicrophone(page);
  const data = dashboard();
  let holdStatus = false;
  let releaseStatus!: () => void;
  const statusGate = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/status") {
      if (holdStatus) await statusGate;
      return route.fulfill({ json: { configured: true, authenticated: true } });
    }
    return route.fulfill({ json: path === "/api/data" ? data : { ok: true } });
  });
  await page.goto("/");
  const voice = page.locator(".weeklyVoiceAction");
  await voice.getByRole("button", { name: "RECORD", exact: true }).click();
  await voice.evaluate((element) => {
    (element as HTMLElement).dataset.recordingIdentity = "original";
  });
  holdStatus = true;
  const request = page.waitForRequest("**/api/status");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await request;
  await expect(page.locator('div[inert][aria-busy="true"]')).toHaveCount(1);
  await expect(voice.getByRole("button", { name: /STOP/ })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { voiceTrackStops: number }).voiceTrackStops,
    ),
  ).toBe(0);
  releaseStatus();
  await expect(page.locator("div[inert]")).toHaveCount(0);
  await expect(voice).toHaveAttribute("data-recording-identity", "original");
  await voice.getByRole("button", { name: /STOP/ }).click();
  await expect(
    voice.getByRole("button", { name: /SEAL VOICE NOTE/ }),
  ).toBeVisible();
  await expect(voice.locator("audio")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => (window as unknown as { voiceTrackStops: number }).voiceTrackStops,
    ),
  ).toBeGreaterThan(0);
});

test("an interrupted session refresh preserves chosen audio through reconnection", async ({
  page,
}) => {
  await mockMicrophone(page);
  const data = dashboard();
  let statusCode = 200;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/status")
      return route.fulfill({
        status: statusCode,
        json:
          statusCode === 200
            ? { configured: true, authenticated: true }
            : { error: "Temporarily offline" },
      });
    return route.fulfill({ json: path === "/api/data" ? data : { ok: true } });
  });
  await page.goto("/");
  const voice = page.locator(".weeklyVoiceAction");
  await voice
    .locator('input[type="file"]')
    .setInputFiles({
      name: "unsaved-note.mp3",
      mimeType: "audio/mpeg",
      buffer: Buffer.from("unsaved audio"),
    });
  const previewUrl = await voice.locator("audio").getAttribute("src");
  statusCode = 503;
  const failedCheck = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/status") && response.status() === 503,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await failedCheck;
  await expect(page.getByText(/Your unsaved work is still here/)).toBeVisible();
  await expect(
    voice.getByRole("button", { name: /SEAL VOICE NOTE/ }),
  ).toBeEnabled();
  await expect(voice.locator("audio")).toHaveAttribute("src", previewUrl!);
  statusCode = 200;
  const restoredCheck = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/status") && response.status() === 200,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await restoredCheck;
  await expect(page.locator("div[inert]")).toHaveCount(0);
  await expect(
    voice.getByText("unsaved-note.mp3", { exact: true }),
  ).toBeVisible();
  await expect(voice.locator("audio")).toHaveAttribute("src", previewUrl!);
});
