import { cancelAgentJob } from "@/lib/agent/dispatch";
import { getStore } from "@/lib/meeting-store";
import { rejectUnauthorized } from "@/server/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string; jobId: string }> }) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;
  const { id, jobId } = await context.params;
  const cancelled = cancelAgentJob(id, jobId);
  return Response.json({ cancelled, meeting: getStore().get(id) });
}