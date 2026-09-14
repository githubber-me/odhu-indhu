import { auth } from "@/lib/auth";
import { recordEvent } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthContext = { params: Promise<{ path: string[] }> };
type AuthMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

const handlers = auth.handler();
const meaningfulActions: Record<string, string> = {
  callback: "Authentication callback completed",
  "sign-in": "Sign-in request completed",
  "sign-up": "Account registration request completed",
  "sign-out": "Sign-out request completed",
  "verify-email": "Email verification request completed",
  "request-password-reset": "Password reset requested",
  "reset-password": "Password reset request completed",
};

async function observedAuthHandler(
  method: AuthMethod,
  request: Request,
  context: AuthContext,
) {
  const route = (await context.params).path;
  const action = route[0] || "unknown";

  try {
    const response = await handlers[method](request, context);
    if (response.status >= 400) {
      await recordEvent({
        level: "error",
        category: "auth",
        eventType: "auth.request.failed",
        outcome: "error",
        message: `Authentication request failed with HTTP ${response.status}`,
        errorCode: `HTTP_${response.status}`,
        metadata: { action, method, status: response.status },
      });
    } else if (meaningfulActions[action]) {
      await recordEvent({
        category: "auth",
        eventType: "auth.request.succeeded",
        outcome: "success",
        message: meaningfulActions[action],
        metadata: { action, method, status: response.status },
      });
    }
    return response;
  } catch (error) {
    await recordEvent({
      level: "error",
      category: "auth",
      eventType: "auth.request.exception",
      outcome: "error",
      message: error instanceof Error ? error.message : "Authentication request failed",
      errorCode: error instanceof Error ? error.name : "AUTH_EXCEPTION",
      metadata: { action, method },
    });
    throw error;
  }
}

export const GET = (request: Request, context: AuthContext) =>
  observedAuthHandler("GET", request, context);
export const POST = (request: Request, context: AuthContext) =>
  observedAuthHandler("POST", request, context);
export const PUT = (request: Request, context: AuthContext) =>
  observedAuthHandler("PUT", request, context);
export const DELETE = (request: Request, context: AuthContext) =>
  observedAuthHandler("DELETE", request, context);
export const PATCH = (request: Request, context: AuthContext) =>
  observedAuthHandler("PATCH", request, context);
