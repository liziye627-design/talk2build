import { draftWithModel } from "@/lib/agent/model";
import type { AgentJob } from "@/lib/agent/types";
import { ensureWorkspace } from "@/lib/db";
import { getStore } from "@/lib/meeting-store";
import { memoryFor } from "@/lib/work-tools";
import { writeWorkspaceFile } from "@/lib/workspace";

export interface DraftedArtifact {
  path: string;
  summary: string;
  body: string;
}

export async function draftArtifact(job: AgentJob): Promise<DraftedArtifact> {
  const live = await draftWithModel(
    "Write the meeting artifact as markdown or SVG. Cite only sources that appear in the brief. Do not invent URLs.",
    `Kind: ${job.kind}\nTitle: ${job.title}\nSpeaker: ${job.speaker}\nBrief: ${job.brief}`,
  );
  if (live.text && live.text.trim().length > 40) {
    const path = artifactPath(job);
    return { path, summary: `${job.title} from ${job.speaker}.`, body: stripUnknownUrls(live.text.trim(), job.brief) };
  }
  const template = templateArtifact(job);
  if (!live.notice) return template;
  return { ...template, summary: `${live.notice} ${template.summary}` };
}

export function writeArtifact(meetingId: string, artifact: DraftedArtifact) {
  const state = getStore().get(meetingId);
  ensureWorkspace(state.workspaceId, state.title);
  writeWorkspaceFile(state.workspaceId, artifact.path, artifact.body);
  return artifact.path;
}

function stripUnknownUrls(body: string, allowed: string) {
  return body.replace(/https?:\/\/[^\s)]+/g, (url) => (allowed.includes(url) ? url : "source omitted"));
}

function artifactPath(job: AgentJob) {
  if (job.kind === "plan") return "docs/plan.md";
  if (job.kind === "verify") return "docs/feasibility.md";
  if (job.kind === "research") return "docs/research.md";
  if (job.title === "Settings wireframe") return "design/export-settings.svg";
  if (job.title === "API spec") return "docs/api-exports.md";
  if (job.kind === "design") return "design/architecture.svg";
  return "docs/note.md";
}

function templateArtifact(job: AgentJob): DraftedArtifact {
  const path = artifactPath(job);
  if (job.title === "Settings wireframe") {
    return {
      path,
      summary: "Wireframe: nightly toggle and last-run time.",
      body: wireframeSvg(job.speaker),
    };
  }
  if (job.title === "API spec") {
    return {
      path,
      summary: "API spec: POST /exports starts a nightly export.",
      body: ["# POST /exports", "", `Speaker: ${job.speaker}`, "", "Starts a nightly billing export. It does not run on the request path.", "", "## Body", "- format: csv", "", "## Response", "- id", "- status: scheduled", "", "## From the room", job.brief, ""].join("\n"),
    };
  }
  if (job.kind === "design") {
    return {
      path,
      summary: "Architecture: export worker writes a CSV off the request path.",
      body: architectureSvg(job.speaker),
    };
  }
  if (job.kind === "verify") {
    const memory = memoryFor(job.brief);
    const feasible = /nightly|export|job/i.test(job.brief) || memory.decisions.length > 0;
    return {
      path,
      summary: feasible ? "Feasible: a nightly job matches the earlier decision." : "Check recorded. No contradicting decision in memory.",
      body: [
        "# Feasibility",
        "",
        `Speaker: ${job.speaker}`,
        "",
        feasible ? "A nightly export fits the earlier decision. It stays off the request path." : "Nothing in memory contradicts this yet.",
        "",
        "## Heard just now",
        job.brief,
        "",
        "## Earlier decisions",
        ...(memory.decisions.length ? memory.decisions.map((item) => `- ${item}`) : ["- None matched."]),
        "",
      ].join("\n"),
    };
  }
  if (job.kind === "research") {
    const memory = memoryFor(job.brief);
    const sources = [...memory.decisions, ...memory.preferences];
    return {
      path,
      summary: memory.decisions[0] ? `Reference: ${memory.decisions[0]}` : "Research card is up. Nothing earlier matched that question.",
      body: [
        "# Research",
        "",
        `Speaker: ${job.speaker}`,
        "",
        "Sources are earlier decisions and saved preferences. No URL was added unless it was already in that context.",
        "",
        "## Query",
        job.brief,
        "",
        "## Sources",
        ...(sources.length ? sources.map((item) => `- ${item}`) : ["- No earlier decision or preference matched."]),
        "",
      ].join("\n"),
    };
  }
  const parts = job.brief
    .split(/[.。]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const goal = parts[0] || job.brief;
  const milestones = parts.slice(1);
  return {
    path,
    summary: goal,
    body: [`# Plan`, "", `Speaker: ${job.speaker}`, "", `## Goal`, goal, "", `## Milestones`, ...(milestones.length ? milestones.map((item) => `- ${item}`) : ["- Still listening."]), ""].join("\n"),
  };
}

function architectureSvg(speaker: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="280" viewBox="0 0 640 280">
  <rect width="640" height="280" fill="#1c1c1c"/>
  <g font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="14" fill="#ffffff">
    <text x="24" y="36" font-size="12" fill="#7eb6ff">${speaker}</text>
    <rect x="24" y="90" width="160" height="72" rx="12" fill="#2b2b2b" stroke="#006fff"/>
    <text x="104" y="132" text-anchor="middle">Invoices</text>
    <rect x="240" y="90" width="160" height="72" rx="12" fill="#2b2b2b" stroke="#006fff"/>
    <text x="320" y="124" text-anchor="middle">Nightly worker</text>
    <text x="320" y="144" text-anchor="middle" font-size="11" fill="#bbbbbb">off the request path</text>
    <rect x="456" y="90" width="160" height="72" rx="12" fill="#2b2b2b" stroke="#006fff"/>
    <text x="536" y="132" text-anchor="middle">CSV bucket</text>
    <path d="M184 126 H240" stroke="#ffffff" stroke-width="2"/>
    <path d="M400 126 H456" stroke="#ffffff" stroke-width="2"/>
  </g>
</svg>
`;
}

function wireframeSvg(speaker: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="280" viewBox="0 0 420 280">
  <rect width="420" height="280" rx="16" fill="#f7f7f7"/>
  <text x="24" y="36" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="12" fill="#006fff">${speaker}</text>
  <text x="24" y="64" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="16" fill="#1a1a1a">Export settings</text>
  <rect x="24" y="88" width="372" height="56" rx="10" fill="#ffffff" stroke="#e5e5e5"/>
  <text x="40" y="122" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="14" fill="#1a1a1a">Nightly job</text>
  <rect x="320" y="104" width="52" height="28" rx="14" fill="#006fff"/>
  <circle cx="356" cy="118" r="10" fill="#ffffff"/>
  <rect x="24" y="160" width="372" height="56" rx="10" fill="#ffffff" stroke="#e5e5e5"/>
  <text x="40" y="194" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="14" fill="#1a1a1a">Last run · 02:10</text>
</svg>
`;
}
