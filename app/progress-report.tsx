import type { ProgressReport as Report } from "@/lib/progress-report";

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export function ProgressReport({
  report,
}: {
  report: Report | null | undefined;
}) {
  if (!report) return null;
  const { metrics } = report;
  const hours = Math.floor(metrics.totalMinutes / 60);
  const minutes = metrics.totalMinutes % 60;
  return (
    <section
      className="releaseProgress"
      aria-labelledby="release-progress-title"
    >
      <div className="releaseProgressHeading">
        <div>
          <p className="eyebrow">YOUR PROGRESS REPORT</p>
          <h2 id="release-progress-title">The work you’ve put in.</h2>
        </div>
        <p className="microcopy">Through {dateLabel(report.cutoffAt)} · IST</p>
      </div>
      <p className="releaseProgressSummary">{metrics.summary}</p>
      <dl className="releaseProgressMetrics">
        <div>
          <dt>STUDY TIME</dt>
          <dd>
            {hours}h {minutes}m
          </dd>
        </div>
        <div>
          <dt>STUDY DAYS</dt>
          <dd>{metrics.activeDays}</dd>
        </div>
        <div>
          <dt>BEST STREAK</dt>
          <dd>{metrics.bestStreak} days</dd>
        </div>
        <div>
          <dt>RECALL ACCURACY</dt>
          <dd>
            {metrics.recallAccuracy === null
              ? "—"
              : `${metrics.recallAccuracy}%`}
          </dd>
        </div>
      </dl>
      <p className="microcopy">
        {metrics.sessionCount} sealed{" "}
        {metrics.sessionCount === 1 ? "session" : "sessions"} ·{" "}
        {metrics.qualifiedDays} {metrics.qualifiedDays === 1 ? "day" : "days"}{" "}
        with an hour of study · {metrics.topicCount}{" "}
        {metrics.topicCount === 1 ? "topic" : "topics"} ·{" "}
        {metrics.recallAttemptCount} completed{" "}
        {metrics.recallAttemptCount === 1 ? "quiz" : "quizzes"}
      </p>
      <p className="microcopy releaseProgressFootnote">
        A saved snapshot of your study entries and completed recall at this
        release. Voice notes are excluded.
      </p>
    </section>
  );
}
