import { handleSttConfig } from "@/server/transcribe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return handleSttConfig();
}
