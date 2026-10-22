"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "@/lib/auth-client";

export function SignOut() {
  const started = useRef(false);
  const [error, setError] = useState("");
  async function leave() {
    setError("");
    try {
      await signOut();
      window.location.replace("/");
    } catch (error) {
      setError((error as Error).message);
    }
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void leave();
  }, []);
  return error ? (
    <div>
      <p role="alert">{error}</p>
      <button className="outlineButton" onClick={() => void leave()}>
        TRY SIGNING OUT AGAIN
      </button>
    </div>
  ) : (
    <p role="status">Signing out…</p>
  );
}
