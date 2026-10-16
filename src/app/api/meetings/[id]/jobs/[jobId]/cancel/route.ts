import { cancelAgentJob } from "@/lib/agent/dispatch";
import { getStore } from "@/lib/meeting-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await context.params;
  const cancelled = cancelAgentJob(id, jobId);
  return Response.json({ cancelled, meeting: getStore().get(id) });
}