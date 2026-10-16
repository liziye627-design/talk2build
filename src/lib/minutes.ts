import type { MeetingState } from "@/lib/types";

export function renderCompletion(state: MeetingState) {
  const line = (title: string, detail: string) => `- ${title}: ${detail}`;
  const ready = state.workstreams.filter((item) => item.status === "ready");
  const waiting = state.workstreams.filter((item) => item.status === "waiting");
  const working = state.workstreams.filter((item) => item.status === "working");
  const cancelled = state.workstreams.filter((item) => item.status === "cancelled");
  const open = state.todos.filter((item) => !item.done);
  return [
    "## Completion",
    "",
    "### Finished during the meeting",
    ...(ready.length ? ready.map((item) => line(item.title, item.summary)) : ["- Nothing had finished."]),
    "",
    "### Still needs a yes",
    ...(waiting.length ? waiting.map((item) => line(item.title, item.summary)) : ["- No consequential action is waiting."]),
    "",
    "### Still running when the meeting closed",
    ...(working.length ? working.map((item) => line(item.title, item.progress || item.summary)) : ["- No job was still running."]),
    "",
    "### Cancelled",
    ...(cancelled.length ? cancelled.map((item) => line(item.title, item.summary)) : ["- None cancelled."]),
    "",
    "### Open action items",
    ...(open.length ? open.map((item) => `- ${item.text} (${item.speaker})`) : ["- No open action items."]),
  ].join("\n");
}

export function renderMinutes(state: MeetingState) {
  const decisions = state.decisions.map((item) => `- ${item.text} (${item.speaker})`).join("\n") || "- None recorded.";
  const todos =
    state.todos.map((item) => `- [${item.done ? "x" : " "}] ${item.text} (${item.speaker})`).join("\n") || "- None captured.";
  const requirements = state.requirements.map((item) => `- ${item.text} (${item.speaker})`).join("\n") || "- None filed.";
  const chatter = state.chatter.map((item) => `- ${item.text}`).join("\n") || "- None parked.";
  const transcript =
    state.transcript.map((line) => `- **${line.speaker}:** ${line.text}`).join("\n") || "- The room was quiet.";
  const work =
    state.workstreams?.map((item) => `- ${item.title} (${item.status}): ${item.summary}`).join("\n") || "- The agent had not started a workstream.";
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
    renderCompletion(state),
    "",
    "## Transcript",
    transcript,
    "",
  ].join("\n");
}
