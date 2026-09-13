import type { Metadata } from "next";
import "@neondatabase/auth-ui/css";
import "./globals.css";
import "./refinements.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Odhu Indhu — Study today. Recall later.",
  description: "A focused SSC CGL study ledger.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
