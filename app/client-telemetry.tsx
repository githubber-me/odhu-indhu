"use client";

import { useEffect } from "react";

type ClientEvent = {
  eventType: string;
  message: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
};

function safeApiPath(pathname: string) {
  if (!pathname.startsWith("/api/auth/")) return pathname;
  const action = pathname.slice("/api/auth/".length).split("/")[0];
  return `/api/auth/${action || "unknown"}`;
}

export function ClientTelemetry() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const recentlySent = new Map<string, number>();

    const send = (event: ClientEvent) => {
      const key = `${event.eventType}:${event.errorCode || ""}:${event.message}`;
      const now = Date.now();
      if (now - (recentlySent.get(key) ?? 0) < 10_000) return;
      recentlySent.set(key, now);
      void originalFetch("/api/client-event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => undefined);
    };

    const instrumentedFetch: typeof window.fetch = async (...args) => {
      const input = args[0];
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(rawUrl, window.location.href);
      const isProductApi =
        url.origin === window.location.origin &&
        url.pathname.startsWith("/api/") &&
        url.pathname !== "/api/client-event";

      try {
        const response = await originalFetch(...args);
        if (isProductApi && !response.ok) {
          void response
            .clone()
            .json()
            .catch(() => null)
            .then((payload: unknown) => {
              const error =
                payload && typeof payload === "object" && "error" in payload
                  ? (payload as { error?: unknown }).error
                  : null;
              send({
                eventType: "client.api.error",
                message: typeof error === "string" ? error : `Request failed with HTTP ${response.status}`,
                errorCode: `HTTP_${response.status}`,
                metadata: {
                  path: safeApiPath(url.pathname),
                  method: args[1]?.method || (input instanceof Request ? input.method : "GET"),
                  status: response.status,
                },
              });
            });
        }
        return response;
      } catch (error) {
        if (isProductApi) {
          send({
            eventType: "client.api.network_error",
            message: error instanceof Error ? error.message : "Network request failed",
            errorCode: "NETWORK_ERROR",
            metadata: {
              path: safeApiPath(url.pathname),
              method: args[1]?.method || (input instanceof Request ? input.method : "GET"),
            },
          });
        }
        throw error;
      }
    };

    const onError = (event: ErrorEvent) => {
      send({
        eventType: "client.runtime.error",
        message: event.message || "Browser runtime error",
        errorCode: event.error?.name || "RUNTIME_ERROR",
        metadata: {
          path: window.location.pathname,
          file: event.filename ? new URL(event.filename, window.location.href).pathname : undefined,
          line: event.lineno || undefined,
          column: event.colno || undefined,
          stack: typeof event.error?.stack === "string" ? event.error.stack.slice(0, 2_000) : undefined,
        },
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      send({
        eventType: "client.promise.rejected",
        message: reason instanceof Error ? reason.message : "Unhandled browser promise rejection",
        errorCode: reason instanceof Error ? reason.name : "UNHANDLED_REJECTION",
        metadata: {
          path: window.location.pathname,
          stack: reason instanceof Error && reason.stack ? reason.stack.slice(0, 2_000) : undefined,
        },
      });
    };

    window.fetch = instrumentedFetch;
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      if (window.fetch === instrumentedFetch) window.fetch = originalFetch;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
