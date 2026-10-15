import { handleMeetingEnd } from "@/server/product";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleMeetingEnd(id);
}
