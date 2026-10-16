"use server";

import { cookies, headers } from "next/headers";
import { cancelJobAuthorized } from "@/server/cancel-job";
import { sessionCookieName } from "@/server/meeting-session";

export async function cancelMeetingJob(meetingId: string, jobId: string) {
  const incoming = new Headers(await headers());
  const cookieValue = (await cookies()).get(sessionCookieName(meetingId))?.value ?? null;
  // Server actions already enforce Origin; skip the duplicate check.
  return cancelJobAuthorized({ headers: incoming, cookieValue, meetingId, jobId, checkOrigin: false });
}
