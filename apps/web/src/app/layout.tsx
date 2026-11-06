import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ULTRON · Personal AI Control Console",
  description:
    "A local-first personal AI system for model orchestration, private memory, approved tools, voice and real work.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
