import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  handleVoiceUploadCallback,
  InvalidVoiceCallbackError,
} from "../lib/voice-callback";

const token = "vercel_blob_rw_test_callback-secret";
const payload = {
  type: "blob.upload-completed" as const,
  payload: {
    blob: {
      url: "https://test.private.blob.vercel-storage.com/weekly/user/note/plan.webm",
      pathname: "weekly/user/note/plan.webm",
      downloadUrl:
        "https://test.private.blob.vercel-storage.com/weekly/user/note/plan.webm",
      contentType: "audio/webm",
      contentDisposition: "attachment",
      etag: "test-etag",
    },
    tokenPayload: JSON.stringify({ userId: "signed-owner" }),
  },
};
const signature = createHmac("sha256", token)
  .update(JSON.stringify(payload))
  .digest("hex");

test("a signed completion saves without a browser Origin or session cookie", async () => {
  const request = new Request("https://example.com/api/weekly/upload", {
    method: "POST",
    headers: { "x-vercel-signature": signature },
  });
  let completed = false;
  const response = await handleVoiceUploadCallback(
    request,
    payload,
    async (verified) => {
      assert.deepEqual(verified, payload.payload);
      completed = true;
    },
    token,
  );
  assert.equal(completed, true);
  assert.deepEqual(response, { type: "blob.upload-completed", response: "ok" });
});

test("missing, malformed, and forged completion signatures never reach save", async () => {
  let saves = 0;
  for (const candidate of ["", "a", "z".repeat(64), "0".repeat(64)]) {
    const request = new Request("https://example.com/api/weekly/upload", {
      method: "POST",
      headers: { "x-vercel-signature": candidate },
    });
    await assert.rejects(
      handleVoiceUploadCallback(
        request,
        payload,
        async () => {
          saves++;
        },
        token,
      ),
      InvalidVoiceCallbackError,
    );
  }
  const forged = {
    ...payload,
    payload: {
      ...payload.payload,
      tokenPayload: JSON.stringify({ userId: "another-user" }),
    },
  };
  const request = new Request("https://example.com/api/weekly/upload", {
    method: "POST",
    headers: { "x-vercel-signature": signature },
  });
  await assert.rejects(
    handleVoiceUploadCallback(
      request,
      forged,
      async () => {
        saves++;
      },
      token,
    ),
    InvalidVoiceCallbackError,
  );
  assert.equal(saves, 0);
});

test("callback handling cannot issue upload credentials", async () => {
  const request = new Request("https://example.com/api/weekly/upload", {
    method: "POST",
    headers: { "x-vercel-signature": signature },
  });
  await assert.rejects(
    handleVoiceUploadCallback(
      request,
      {
        type: "blob.generate-client-token",
        payload: {
          pathname: "weekly/other-user/audio.webm",
          clientPayload: null,
          multipart: false,
        },
      },
      async () => assert.fail("Token generation reached save"),
      token,
    ),
    InvalidVoiceCallbackError,
  );
});
