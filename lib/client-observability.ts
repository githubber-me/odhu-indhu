"use client";

type ClientEvent = {
  level?: "info" | "warn" | "error";
  eventType: string;
  outcome?: string;
  message: string;
  errorCode?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export function reportClientEvent(event: ClientEvent) {
  const metadata = Object.fromEntries(
    Object.entries(event.metadata ?? {}).filter((entry) => entry[1] !== undefined),
  );
  void fetch("/api/client-event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...event, metadata }),
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);
}

export function reportClientIssue(issue: ClientEvent) {
  reportClientEvent({ level: "error", outcome: "error", ...issue });
}
