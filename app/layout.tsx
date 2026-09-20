import type { Metadata, Viewport } from "next";
import "@fontsource-variable/unbounded";
import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "RAS CORE — IEEE RAS AI Agent",
  description: "An autonomous RAG agent for the IEEE Robotics & Automation Society — with a live 3D view of its knowledge space.",
  openGraph: {
    title: "RAS CORE — IEEE RAS AI Agent",
    description: "Ask anything about IEEE RAS. Watch retrieval happen live in 3D.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#060a14", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body>{children}</body>
    </html>
  );
}
