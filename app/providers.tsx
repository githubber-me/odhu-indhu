"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { NeonAuthUIProvider } from "@neondatabase/auth-ui";
import { authClient, notifySessionChange } from "@/lib/auth-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const session = authClient.useSession();
  const previousSubject = useRef<string | null | undefined>(undefined);
  const subject = session.data?.user?.id || null;
  useEffect(() => {
    if (session.isPending || session.error) return;
    if (
      previousSubject.current !== undefined &&
      previousSubject.current !== subject
    )
      notifySessionChange();
    previousSubject.current = subject;
  }, [session.isPending, session.error, subject]);
  return (
    <NeonAuthUIProvider
      authClient={authClient}
      navigate={router.push}
      replace={router.replace}
      onSessionChange={() => {
        notifySessionChange();
        router.refresh();
      }}
      credentials={false}
      magicLink
      social={{ providers: ["google"] }}
      redirectTo="/"
      defaultTheme="light"
      Link={Link}
    >
      {children}
    </NeonAuthUIProvider>
  );
}
