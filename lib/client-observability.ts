"use client";

type ClientIssue = {
  eventType: string;
  message: string;
  errorCode?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export function reportClientIssue(issue: ClientIssue) {
  const metadata = Object.fromEntries(
    Object.entries(issue.metadata ?? {}).filter((entry) => entry[1] !== undefined),
  );
  void fetch("/api/client-event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...issue, metadata }),
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);
}
