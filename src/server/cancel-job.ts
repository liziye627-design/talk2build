import { cancelAgentJob } from "@/lib/agent/dispatch";
import { authorizeCancel } from "@/server/meeting-session";

/** Plain module (not a server action): callers cannot supply their own headers from the client. */
export function cancelJobAuthorized(input: { headers: Headers; cookieValue?: string | null; meetingId: string; jobId: string; checkOrigin?: boolean }) {
  if (!authorizeCancel(input)) return { cancelled: false, error: "Unauthorized" as const };
  return { cancelled: cancelAgentJob(input.meetingId, input.jobId) };
}
