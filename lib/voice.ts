import { z } from "zod";
import { shiftDate } from "./domain";
import { startOfIstWeek } from "./weekly-domain";

export const MAX_VOICE_BYTES = 25 * 1024 * 1024;
export const voiceNoteSchema = z.object({
  noteId: z.string().uuid(),
  weekStart: z.string().date(),
  kind: z.enum(["plan", "reflection"]),
});
export type VoiceNoteInput = z.infer<typeof voiceNoteSchema>;

const audioTypes: Record<string, string> = {
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
};
const aliases: Record<string, string> = {
  "audio/m4a": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/x-wav": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/x-flac": "audio/flac",
  "video/webm": "audio/webm",
};

export const VOICE_CONTENT_TYPES = [
  ...new Set([...Object.values(audioTypes), ...Object.keys(aliases)]),
];

export function voiceContentType(type: string, name = "") {
  const base = type.split(";")[0].trim().toLowerCase();
  const normalized = aliases[base] || base;
  if (Object.values(audioTypes).includes(normalized)) return normalized;
  // Some mobile file pickers omit the MIME type entirely.
  if (!base || base === "application/octet-stream")
    return audioTypes[name.split(".").pop()?.toLowerCase() || ""] || null;
  return null;
}

export function voiceExtension(type: string) {
  const normalized = voiceContentType(type);
  return (
    Object.entries(audioTypes).find(([, mime]) => mime === normalized)?.[0] ||
    "webm"
  );
}

export function voiceUploadPrefix(userId: string, noteId: string) {
  return `weekly/${userId}/${noteId}/`;
}

export function voicePathMatches(
  pathname: string,
  userId: string,
  note: VoiceNoteInput,
) {
  const prefix = voiceUploadPrefix(userId, note.noteId);
  if (!pathname.startsWith(prefix)) return false;
  const filename = pathname.slice(prefix.length);
  return new RegExp(
    `^${note.kind}-${note.weekStart}(?:-[a-zA-Z0-9]+)?\\.(aac|flac|m4a|mp4|mp3|ogg|opus|wav|webm)$`,
  ).test(filename);
}

export function voiceNoteOpen(note: VoiceNoteInput, today: string) {
  if (startOfIstWeek(note.weekStart) !== note.weekStart) return false;
  const currentWeek = startOfIstWeek(today);
  return note.kind === "plan"
    ? note.weekStart === currentWeek
    : note.weekStart <= currentWeek && today >= shiftDate(note.weekStart, 6);
}

export function validateVoiceFile(file: Pick<File, "name" | "size" | "type">) {
  if (!file.size)
    return "This audio file is empty. Record again or choose another file.";
  if (file.size > MAX_VOICE_BYTES)
    return "Please choose a voice note smaller than 25 MB.";
  if (!voiceContentType(file.type, file.name))
    return "Choose a supported audio file: WebM, MP3, M4A, WAV, OGG, AAC, or FLAC.";
  return null;
}

export function transcriptFrom(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.transcript === "string" && record.transcript.trim())
    return record.transcript.trim();
  for (const nested of Object.values(record)) {
    const found = transcriptFrom(nested);
    if (found) return found;
  }
  return "";
}
