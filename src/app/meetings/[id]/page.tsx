import { MeetingStage } from "@/components/meeting-stage";

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MeetingStage meetingId={id} />;
}
