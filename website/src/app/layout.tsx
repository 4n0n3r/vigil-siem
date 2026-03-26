import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vigil — CLI-first SIEM for AI Agents",
  description:
    "Open source SIEM built for engineers and AI agents. Real-time Sigma detection, structured JSON output, and human-in-the-loop approvals.",
  metadataBase: new URL("https://vigilsec.io"),
  openGraph: {
    title: "Vigil — CLI-first SIEM for AI Agents",
    description:
      "Real-time threat detection, structured JSON output, and human-in-the-loop approvals. Built for AI agents.",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vigil SIEM",
    description: "CLI-first SIEM for AI agents.",
  },
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-bg-primary text-text-primary font-body">
        {children}
      </body>
    </html>
  );
}
