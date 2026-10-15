import type { MeetingState } from "@/lib/types";

export function renderMinutes(state: MeetingState) {
  const decisions = state.decisions.map((item) => `- ${item.text} (${item.speaker})`).join("\n") || "- None recorded.";
  const todos =
    state.todos.map((item) => `- [${item.done ? "x" : " "}] ${item.text} (${item.speaker})`).join("\n") || "- None captured.";
  const requirements = state.requirements.map((item) => `- ${item.text} (${item.speaker})`).join("\n") || "- None filed.";
  const chatter = state.chatter.map((item) => `- ${item.text}`).join("\n") || "- None parked.";
  const transcript =
    state.transcript.map((line) => `- **${line.speaker}:** ${line.text}`).join("\n") || "- The room was quiet.";
  const work =
    state.workstreams?.map((item) => `- ${item.title}: ${item.summary}`).join("\n") || "- The agent had not started a workstream.";
  return [
    `# ${state.title}`,
    "",
    `Status: ${state.status}. Join code ${state.joinCode}.`,
    "",
    "## Decisions",
    decisions,
    "",
    "## Action items",
    todos,
    "",
    "## Requirements",
    requirements,
    "",
    "## Chatter left out of the pool",
    chatter,
    "",
    "## Agent work",
    work,
    "",
    "## Transcript",
    transcript,
    "",
  ].join("\n");
}
