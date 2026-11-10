import { redirect } from "next/navigation";

// This legacy Next.js entry point forwards to the canonical Vercel-hosted
// ULTRON chat client. The public app is built from apps/phone.
export default function Home() {
  redirect("https://ultron-pied-gamma.vercel.app/");
}
