import { getStore } from "@/lib/meeting-store";
import { cancelJobAuthorized } from "@/server/cancel-job";
import { unauthorizedResponse } from "@/server/meeting-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await context.params;
  const result = cancelJobAuthorized({ headers: request.headers, meetingId: id, jobId });
  if (result.error) return unauthorizedResponse();
  return Response.json({ cancelled: result.cancelled, meeting: getStore().get(id) });
}
