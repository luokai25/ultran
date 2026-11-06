import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ULTRON | Secondary Owner Console",
  description:
    "A secondary ULTRON console for the 3D avatar and Model Hub. Production chat, tools and task workflows use the shared apps/phone client.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
