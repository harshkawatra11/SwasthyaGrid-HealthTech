import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "SwasthyaGrid AI: District Health Operations Center",
  description:
    "An AI district health operations center that predicts, explains, and recommends resource redistribution across PHCs and CHCs. Human always in the loop.",
  keywords: ["healthcare", "AI", "district health", "PHC", "Gemini", "Google Cloud"],
  openGraph: {
    title: "SwasthyaGrid AI",
    description: "Predictive · Prescriptive · Explainable · Human-Governed",
    url: "https://swasthyagrid.vercel.app",
    siteName: "SwasthyaGrid AI",
    locale: "en_IN",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-bg text-text">{children}</body>
    </html>
  );
}
