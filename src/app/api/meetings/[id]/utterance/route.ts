import { handleTurn } from "@/server/routes";
import { stampSource } from "@/server/transcribe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json()) as Record<string, unknown>;
  const response = await handleTurn(
    new Request(request.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, meetingId: id }),
    }),
  );
  if (response.ok && typeof body.text === "string") stampSource(id, body.text, body.source);
  return response;
}
