import { handleMeetingsGet, handleMeetingsPost } from "@/server/product";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handleMeetingsGet;
export const POST = handleMeetingsPost;
