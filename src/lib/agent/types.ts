import type { WorkKind } from "@/lib/types";

export interface AgentJob {
  id: string;
  meetingId: string;
  kind: WorkKind;
  title: string;
  brief: string;
  speaker: string;
  needsConfirm: boolean;
}

export interface Extraction {
  speaker: string;
  intents: Array<{ kind: string; summary: string; speaker: string }>;
  decisions: Array<{ text: string; speaker: string }>;
  actionItems: Array<{ text: string; speaker: string }>;
  jobs: AgentJob[];
  chatter: string | null;
  suggestion: string | null;
}

export interface ExtractInput {
  meetingId: string;
  speaker: string;
  text: string;
  context: string;
}
