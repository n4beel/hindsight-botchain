import type { Metadata, Viewport } from "next";
import { Spectral, Commissioner, Victor_Mono } from "next/font/google";
import { EvmProvider } from "@/components/providers/EvmProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { app } from "@/lib/app-config";
import "./globals.css";

const spectral = Spectral({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-spectral",
  display: "swap",
});

const commissioner = Commissioner({
  subsets: ["latin"],
  variable: "--font-commissioner",
  display: "swap",
});

const victorMono = Victor_Mono({
  subsets: ["latin"],
  variable: "--font-victor-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${app.name} — ${app.tagline}`,
  description: app.tagline,
  icons: { icon: "/icon.png" },
  openGraph: { title: app.name, description: app.tagline, type: "website", url: app.url },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0E2A35",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${spectral.variable} ${commissioner.variable} ${victorMono.variable} h-full`}
      style={{
        ["--accent" as string]: app.accent,
        ["--accent-ink" as string]: "#0E2A35",
      }}
    >
      <body className="min-h-full antialiased timeline-atmosphere">
        <EvmProvider>
          <ToastProvider>{children}</ToastProvider>
        </EvmProvider>
      </body>
    </html>
  );
}
