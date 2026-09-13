import { z } from "zod";
export const entrySchema = z
  .object({
    id: z.string().uuid(),
    content: z.string().trim().min(3).max(12000),
    duration: z.number().int().min(1).max(720),
  })
  .strict();
export const questionSchema = z
  .object({
    stem: z.string().min(10),
    options: z
      .array(
        z.object({ text: z.string().min(1), explanation: z.string().min(10) }),
      )
      .length(4),
    correct: z.number().int().min(0).max(3),
    solution: z.string().min(20),
    sources: z
      .array(
        z
          .string()
          .url()
          .refine((url) => /^https?:\/\//i.test(url)),
      )
      .min(1),
  })
  .refine(
    (q) =>
      new Set(q.options.map((o) => o.text.trim().toLowerCase())).size === 4,
    "Options must be distinct",
  );
export type Question = z.infer<typeof questionSchema>;
export function istDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    now,
  );
}
export function shiftDate(date: string, delta: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
export function streakStats(
  sessions: { date: string; duration: number }[],
  today = istDate(),
) {
  const totals: Record<string, number> = {};
  for (const s of sessions) totals[s.date] = (totals[s.date] || 0) + s.duration;
  const dates = Object.keys(totals)
    .filter((d) => totals[d] >= 60)
    .sort();
  let best = 0,
    run = 0,
    previous = "";
  for (const date of dates) {
    run = shiftDate(previous || date, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }
  let cursor = totals[today] >= 60 ? today : shiftDate(today, -1),
    current = 0;
  while (totals[cursor] >= 60) {
    current++;
    cursor = shiftDate(cursor, -1);
  }
  return { current, best, total: totals[today] || 0, totals };
}
export function publicQuestions(questions: Question[]) {
  return questions.map((q) => ({
    stem: q.stem,
    options: q.options.map((o) => o.text),
  }));
}
export function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    let s =
      typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "");
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    "\uFEFF" +
    [headers, ...rows.map((r) => headers.map((h) => r[h]))]
      .map((row) => row.map(escape).join(","))
      .join("\r\n")
  );
}
