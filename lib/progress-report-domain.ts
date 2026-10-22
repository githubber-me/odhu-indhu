import { streakStats } from "./domain";

export const PROGRESS_REPORT_RELEASE_ID = "2026-10-login-voice-progress-v1";

export type ProgressSnapshot = {
  sessionCount: number;
  dailyMinutes: { date: string; minutes: number }[];
  topicCount: number;
  subjects: { name: string; topics: number }[];
  recallSetCount: number;
  availableRecallCount: number;
  recallAttemptCount: number;
  recallQuestionCount: number;
  correctAnswerCount: number;
};

export type ProgressReportMetrics = ProgressSnapshot & {
  totalMinutes: number;
  activeDays: number;
  qualifiedDays: number;
  currentStreak: number;
  bestStreak: number;
  firstStudyDate: string | null;
  lastStudyDate: string | null;
  recallAccuracy: number | null;
  summary: string;
};

export type ProgressReport = {
  releaseId: string;
  cutoffAt: string;
  cutoffDate: string;
  generatedAt: string;
  metrics: ProgressReportMetrics;
};

// Every value comes from the deployment snapshot. In particular, the streak's
// reference day must never advance when a learner opens this report later.
export function progressReportMetrics(
  snapshot: ProgressSnapshot,
  cutoffDate: string,
): ProgressReportMetrics {
  const dailyMinutes = snapshot.dailyMinutes
    .filter((day) => day.date <= cutoffDate && day.minutes > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const totalMinutes = dailyMinutes.reduce((sum, day) => sum + day.minutes, 0);
  const activeDays = dailyMinutes.length;
  const qualifiedDays = dailyMinutes.filter((day) => day.minutes >= 60).length;
  const streaks = streakStats(
    dailyMinutes.map((day) => ({ date: day.date, duration: day.minutes })),
    cutoffDate,
  );
  const recallAccuracy = snapshot.recallQuestionCount
    ? Math.round(
        (snapshot.correctAnswerCount / snapshot.recallQuestionCount) * 100,
      )
    : null;
  const studySummary = snapshot.sessionCount
    ? `You logged ${totalMinutes} minutes in ${snapshot.sessionCount} study ${snapshot.sessionCount === 1 ? "session" : "sessions"} across ${activeDays} ${activeDays === 1 ? "day" : "days"}. ${qualifiedDays} ${qualifiedDays === 1 ? "day reached" : "days reached"} the one-hour mark.`
    : "No study entries had been recorded by this report's cutoff.";
  const recallSummary = snapshot.recallAttemptCount
    ? ` You completed ${snapshot.recallAttemptCount} recall ${snapshot.recallAttemptCount === 1 ? "attempt" : "attempts"}${recallAccuracy === null ? "." : ` with ${recallAccuracy}% accuracy across ${snapshot.recallQuestionCount} ${snapshot.recallQuestionCount === 1 ? "question" : "questions"}.`}`
    : " No recall attempts had been completed yet.";
  return {
    ...snapshot,
    dailyMinutes,
    totalMinutes,
    activeDays,
    qualifiedDays,
    currentStreak: streaks.current,
    bestStreak: streaks.best,
    firstStudyDate: dailyMinutes[0]?.date ?? null,
    lastStudyDate: dailyMinutes.at(-1)?.date ?? null,
    recallAccuracy,
    summary: studySummary + recallSummary,
  };
}
