"use client";

import { createAuthClient } from "@neondatabase/auth/next";

export const authClient = createAuthClient();

export const AUTH_SESSION_CHANGED = "odhu-indhu:session-changed";

export function notifySessionChange() {
  window.dispatchEvent(new Event(AUTH_SESSION_CHANGED));
}

export async function signOut() {
  const result = await authClient.signOut();
  if (result.error)
    throw new Error(
      result.error.message || "Unable to sign out. Please try again.",
    );
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (
        key &&
        (key === "odhu-indhu-entry-draft" ||
          key.startsWith("odhu-indhu-entry-draft:") ||
          key.startsWith("odhu-indhu-day-draft:"))
      )
        sessionStorage.removeItem(key);
    }
  } catch {}
  notifySessionChange();
}
