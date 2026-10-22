import "server-only";
import { db } from "./db";
import {
  PROGRESS_REPORT_RELEASE_ID,
  progressReportMetrics,
  type ProgressReport,
  type ProgressSnapshot,
} from "./progress-report-domain";
import {
  CAPTURE_DEPLOYMENT_PROGRESS,
  PROGRESS_REPORT_SCHEMA,
} from "./progress-report-sql";

export type { ProgressReport } from "./progress-report-domain";

let initialization: Promise<void> | undefined;

export async function ensureDeploymentProgressReports() {
  // A preview can share production's database. Only a live production function
  // may establish this release's audience and cutoff, after the deploy is live.
  if (process.env.VERCEL_ENV !== "production") return;
  initialization ??= db()
    .begin(async (tx) => {
      // Serializes first requests across server instances, including table DDL.
      await tx`SELECT pg_advisory_xact_lock(20261022,1)`;
      await tx.unsafe(PROGRESS_REPORT_SCHEMA);
      await tx.unsafe(CAPTURE_DEPLOYMENT_PROGRESS);
    })
    .then(() => undefined)
    .catch((cause: unknown) => {
      initialization = undefined;
      throw new Error(
        "The deployment progress report could not be prepared. Please try again.",
        {
          cause,
        },
      );
    });
  await initialization;
}

export async function progressReportForUser(
  userId: string,
): Promise<ProgressReport | null> {
  if (process.env.VERCEL_ENV !== "production") return null;
  await ensureDeploymentProgressReports();
  const rows = await db()`
    SELECT r.campaign_id AS "releaseId",c.cutoff_at AS "cutoffAt",
           c.cutoff_date AS "cutoffDate",r.generated_at AS "generatedAt",r.snapshot
    FROM progress_reports r
    JOIN progress_report_campaigns c ON c.id=r.campaign_id
    WHERE r.user_id=${userId} AND r.campaign_id=${PROGRESS_REPORT_RELEASE_ID}
    LIMIT 1`;
  if (!rows.length) return null;
  const row = rows[0];
  return {
    releaseId: String(row.releaseId),
    cutoffAt: new Date(row.cutoffAt).toISOString(),
    cutoffDate: String(row.cutoffDate),
    generatedAt: new Date(row.generatedAt).toISOString(),
    metrics: progressReportMetrics(
      row.snapshot as ProgressSnapshot,
      row.cutoffDate,
    ),
  };
}
