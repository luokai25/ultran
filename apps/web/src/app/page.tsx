import { redirect } from "next/navigation";

// ULTRON has one canonical web client shared with the Android APK.
// Keep the legacy Next.js entry point from presenting a second, divergent UI.
export default function Home() {
  redirect("https://ultron-app-web.luo-chat-ops.workers.dev/");
}
