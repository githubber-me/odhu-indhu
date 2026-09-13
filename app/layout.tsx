import type { Metadata, Viewport } from "next";
import "@neondatabase/auth-ui/css";
import "./globals.css";
import "./refinements.css";
import { Providers } from "./providers";

const deploymentHost =
  process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
const siteUrl = deploymentHost
  ? deploymentHost.startsWith("http")
    ? deploymentHost
    : `https://${deploymentHost}`
  : "http://localhost:3000";
const title = "Odhu Indhu | One hour. Every day.";
const description =
  "A quiet study companion for honest daily streaks and evidence-grounded recall.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  applicationName: "Odhu Indhu",
  keywords: [
    "study tracker",
    "study streak",
    "study journal",
    "daily study",
    "spaced recall",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: "/",
    siteName: "Odhu Indhu",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/opengraph-image"],
  },
  appleWebApp: {
    capable: true,
    title: "Odhu Indhu",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  robots: { index: true, follow: true },
  category: "education",
};

export const viewport: Viewport = {
  themeColor: "#a51c20",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "Odhu Indhu",
              url: siteUrl,
              description,
              applicationCategory: "EducationalApplication",
              operatingSystem: "Any",
            }).replace(/</g, "\\u003c"),
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
