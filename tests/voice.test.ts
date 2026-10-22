import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_VOICE_BYTES,
  transcriptFrom,
  validateVoiceFile,
  voiceContentType,
  voiceExtension,
  voiceNoteOpen,
  voicePathMatches,
} from "../lib/voice";

const userId = "550e8400-e29b-41d4-a716-446655440001";
const note = {
  noteId: "550e8400-e29b-41d4-a716-446655440002",
  weekStart: "2026-10-19",
  kind: "plan" as const,
};

test("upload ownership binds learner, note, week, kind, and a single audio filename", () => {
  const prefix = `weekly/${userId}/${note.noteId}/`;
  assert.equal(
    voicePathMatches(prefix + "plan-2026-10-19.webm", userId, note),
    true,
  );
  assert.equal(
    voicePathMatches(prefix + "plan-2026-10-19-AbC123.webm", userId, note),
    true,
  );
  for (const filename of [
    "reflection-2026-10-19.webm",
    "plan-2026-10-12.webm",
    "plan-2026-10-19.html",
    "nested/plan-2026-10-19.webm",
    "../plan-2026-10-19.webm",
    "plan-2026-10-19.webm/extra",
  ])
    assert.equal(voicePathMatches(prefix + filename, userId, note), false);
  assert.equal(
    voicePathMatches(prefix + "plan-2026-10-19.webm", note.noteId, note),
    false,
  );
  assert.equal(
    voicePathMatches(
      `weekly/${note.noteId}/plan-2026-10-19.webm`,
      userId,
      note,
    ),
    false,
  );
});

test("voice notes open on valid Monday-based weeks and reflections wait until Sunday", () => {
  assert.equal(voiceNoteOpen(note, "2026-10-22"), true);
  assert.equal(voiceNoteOpen(note, "2026-10-26"), false);
  assert.equal(
    voiceNoteOpen({ ...note, weekStart: "2026-10-20" }, "2026-10-22"),
    false,
  );
  assert.equal(
    voiceNoteOpen({ ...note, kind: "reflection" }, "2026-10-24"),
    false,
  );
  assert.equal(
    voiceNoteOpen({ ...note, kind: "reflection" }, "2026-10-25"),
    true,
  );
  assert.equal(
    voiceNoteOpen({ ...note, kind: "reflection" }, "2026-10-26"),
    true,
  );
});

test("mobile and recorder MIME types retain their real audio format", () => {
  assert.equal(voiceContentType("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(voiceContentType("video/webm"), "audio/webm");
  assert.equal(voiceContentType("audio/x-m4a"), "audio/mp4");
  assert.equal(voiceContentType("", "VOICE.FLAC"), "audio/flac");
  assert.equal(
    voiceContentType("application/octet-stream", "voice.ogg"),
    "audio/ogg",
  );
  assert.equal(voiceContentType("text/html", "voice.mp3"), null);
  assert.equal(voiceExtension("audio/flac"), "flac");
  assert.equal(voiceExtension("audio/webm;codecs=opus"), "webm");
  assert.equal(voiceExtension("audio/aac"), "aac");
});

test("voice validation rejects empty, oversized, and unsupported files before upload", () => {
  assert.match(
    validateVoiceFile({ name: "empty.webm", size: 0, type: "audio/webm" })!,
    /empty/,
  );
  assert.match(
    validateVoiceFile({
      name: "big.mp3",
      size: MAX_VOICE_BYTES + 1,
      type: "audio/mpeg",
    })!,
    /25 MB/,
  );
  assert.match(
    validateVoiceFile({ name: "fake.mp3", size: 1024, type: "text/html" })!,
    /supported audio/,
  );
  assert.equal(
    validateVoiceFile({ name: "voice.m4a", size: MAX_VOICE_BYTES, type: "" }),
    null,
  );
});

test("transcription extraction ignores metadata and only accepts transcript fields", () => {
  assert.equal(
    transcriptFrom({
      request_id: "not speech",
      data: { transcript: "  Revise geography.  " },
    }),
    "Revise geography.",
  );
  assert.equal(
    transcriptFrom([{ language_code: "kn-IN" }, { transcript: "ಕನ್ನಡ" }]),
    "ಕನ್ನಡ",
  );
  assert.equal(
    transcriptFrom({ request_id: "not speech", language_code: "en-IN" }),
    "",
  );
  assert.equal(transcriptFrom({ transcript: "  " }), "");
});
