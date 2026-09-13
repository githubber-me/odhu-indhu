import { shiftDate } from "./domain";

export type WeeklyGoal = {
  title: string;
  category: string;
  target: string;
};

export type WeeklyReflection = {
  highlights: string[];
  challenges: string[];
  nextSteps: string[];
};

export type WeeklyReportMetrics = {
  weekStart: string;
  weekEnd: string;
  totalMinutes: number;
  previousMinutes: number;
  activeDays: number;
  qualifiedDays: number;
  sessionCount: number;
  dailyMinutes: { date: string; minutes: number }[];
  categories: { name: string; minutes: number; topics: number }[];
  goals: (WeeklyGoal & {
    status: "achieved" | "partial" | "not observed";
    evidence: string[];
  })[];
  reflection: WeeklyReflection;
  summary: string;
  improvements: string[];
};

export function startOfIstWeek(date: string) {
  const noon = new Date(date + "T12:00:00Z");
  const day = noon.getUTCDay();
  return shiftDate(date, -(day === 0 ? 6 : day - 1));
}

export function weekLabel(weekStart: string) {
  const end = shiftDate(weekStart, 6);
  const format = (date: string) =>
    new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "Asia/Kolkata",
    }).format(new Date(date + "T12:00:00+05:30"));
  return `${format(weekStart)} to ${format(end)}`;
}

const stopWords = new Set([
  "and",
  "the",
  "for",
  "with",
  "from",
  "this",
  "that",
  "study",
  "learn",
  "revise",
  "practice",
  "complete",
  "finish",
  "about",
]);

function tokens(value: string) {
  return new Set(
    value
      .toLocaleLowerCase("en-IN")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 2 && !stopWords.has(word)),
  );
}

export function goalEvidence(
  goal: WeeklyGoal,
  actual: { topic: string; subject: string }[],
) {
  const goalTokens = tokens(`${goal.title} ${goal.category}`);
  const categoryTokens = tokens(goal.category);
  const evidence: string[] = [];
  let categoryOnly = false;
  for (const item of actual) {
    const itemTokens = tokens(`${item.topic} ${item.subject}`);
    const subjectTokens = tokens(item.subject);
    if ([...goalTokens].some((token) => itemTokens.has(token)))
      evidence.push(item.topic);
    else if ([...categoryTokens].some((token) => subjectTokens.has(token)))
      categoryOnly = true;
  }
  return {
    status: evidence.length
      ? ("achieved" as const)
      : categoryOnly
        ? ("partial" as const)
        : ("not observed" as const),
    evidence: [...new Set(evidence)].slice(0, 3),
  };
}
