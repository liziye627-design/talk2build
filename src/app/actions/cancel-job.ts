"use server";

import { cancelAgentJob } from "@/lib/agent/dispatch";

export async function cancelMeetingJob(meetingId: string, jobId: string) {
  return { cancelled: cancelAgentJob(meetingId, jobId) };
}
