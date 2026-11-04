import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ultron - Local AI Agentic Workspace",
  description:
    "A local-first agent workspace: connector marketplace, local AI brains, builder, forge, billing and 3D Ultron avatar.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
