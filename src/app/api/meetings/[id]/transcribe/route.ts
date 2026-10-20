import { handleMeetingTranscribe } from "@/server/transcribe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleMeetingTranscribe(request, id);
}
