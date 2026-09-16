import { z } from "zod";

export const DAY_ACTIVITIES = [
  "Study",
  "Work",
  "Sleep",
  "Break",
  "Exercise",
  "Travel",
  "Personal",
  "Other",
] as const;

export const dayEntrySchema = z
  .object({
    id: z.string().uuid(),
    date: z.string().date(),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    activity: z.enum(DAY_ACTIVITIES),
    subject: z.string().trim().max(100),
    topic: z.string().trim().max(200),
    note: z.string().trim().max(2_000),
    allowOverlap: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((entry, context) => {
    const interval = dayEntryInterval(entry.startTime, entry.endTime);
    if (!interval)
      context.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "End time must be after start time within the calendar day.",
      });
    if (entry.activity === "Study") {
      if (!entry.subject)
        context.addIssue({
          code: "custom",
          path: ["subject"],
          message: "A study subject is required.",
        });
      if (!entry.topic)
        context.addIssue({
          code: "custom",
          path: ["topic"],
          message: "A study topic is required.",
        });
      if (interval && interval.duration > 720)
        context.addIssue({
          code: "custom",
          path: ["endTime"],
          message: "A single study row cannot exceed 12 hours.",
        });
    }
  });

export type DayActivity = (typeof DAY_ACTIVITIES)[number];
export type DayEntryInput = z.infer<typeof dayEntrySchema>;
export type DayEntry = {
  id: string;
  date: string;
  startMinute: number;
  endMinute: number;
  duration: number;
  activity: DayActivity;
  subject: string;
  topic: string;
  note: string;
  createdAt: string;
};

export function timeToMinute(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function dayEntryInterval(startTime: string, endTime: string) {
  const startMinute = timeToMinute(startTime);
  let endMinute = timeToMinute(endTime);
  if (startMinute === null || endMinute === null) return null;
  // Midnight can close the final row of a calendar day.
  if (endMinute === 0 && startMinute > 0) endMinute = 24 * 60;
  if (endMinute <= startMinute) return null;
  return {
    startMinute,
    endMinute,
    duration: endMinute - startMinute,
  };
}

export function minuteLabel(minute: number) {
  if (minute === 24 * 60) return "24:00";
  return `${Math.floor(minute / 60)
    .toString()
    .padStart(2, "0")}:${(minute % 60).toString().padStart(2, "0")}`;
}

export function coveredMinutes(
  entries: Pick<DayEntry, "startMinute" | "endMinute">[],
) {
  const ranges = entries
    .map((entry) => [entry.startMinute, entry.endMinute] as const)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let start = -1;
  let end = -1;
  for (const range of ranges) {
    if (range[0] > end) {
      if (end >= 0) covered += end - start;
      [start, end] = range;
    } else end = Math.max(end, range[1]);
  }
  if (end >= 0) covered += end - start;
  return covered;
}

export function studyContent(subject: string, topic: string, note: string) {
  return `${subject}: ${topic}${note ? `\n${note}` : ""}`;
}
