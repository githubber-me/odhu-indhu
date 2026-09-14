import "server-only";
import type postgres from "postgres";
import { db } from "./db";

type EventInput = {
  level?: "info" | "warn" | "error";
  category:
    | "api"
    | "client"
    | "auth"
    | "storage"
    | "study"
    | "topic"
    | "voice"
    | "report";
  eventType: string;
  outcome: string;
  userId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  message: string;
  errorCode?: string | null;
  metadata?: Record<string, unknown>;
};

function cleanText(value: string, maximum: number) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum);
}

function jsonSafe(value: Record<string, unknown>): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

export async function recordEvent(event: EventInput) {
  try {
    const sql = db();
    await sql`
      INSERT INTO admin_event_log(
        level,category,event_type,outcome,user_id,entity_type,entity_id,
        message,error_code,metadata
      ) VALUES(
        ${event.level ?? "info"},${event.category},${cleanText(event.eventType, 120)},
        ${cleanText(event.outcome, 40)},${event.userId ?? null},
        ${event.entityType ?? null},${event.entityId ?? null},
        ${cleanText(event.message, 500)},${event.errorCode ? cleanText(event.errorCode, 160) : null},
        ${sql.json(jsonSafe(event.metadata ?? {}))}
      )`;
  } catch (error) {
    // Observability must never take the product down. Keep the platform log as
    // a fallback when the event table is unavailable on a new branch.
    console.error("[observability] event write failed", {
      eventType: event.eventType,
      message: error instanceof Error ? error.message : "Unknown failure",
    });
  }
}
