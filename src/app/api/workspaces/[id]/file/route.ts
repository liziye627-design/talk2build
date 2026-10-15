import { handleWorkspaceFile } from "@/server/product";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const path = new URL(request.url).searchParams.get("path") || "";
  return handleWorkspaceFile(id, path);
}
