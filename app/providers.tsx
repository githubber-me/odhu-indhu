"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { NeonAuthUIProvider } from "@neondatabase/auth-ui";
import { authClient } from "@/lib/auth-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <NeonAuthUIProvider
      authClient={authClient}
      navigate={router.push}
      replace={router.replace}
      onSessionChange={() => router.refresh()}
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
