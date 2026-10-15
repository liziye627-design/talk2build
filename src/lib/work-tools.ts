import { ensureWorkspace, listMeetings, listPreferences, savePreference } from "@/lib/db";
import { getStore } from "@/lib/meeting-store";
import type { ToolResult, Workstream } from "@/lib/types";
import { writeWorkspaceFile } from "@/lib/workspace";

function textOf(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function meetingIdOf(args: Record<string, unknown>) {
  return textOf(args.meetingId) || "demo";
}

function upsert(id: string, draft: Omit<Workstream, "id" | "updatedAt"> & { id?: string }) {
  const store = getStore();
  const state = store.ensure(id);
  const current = state.workstreams.find((item) => item.kind === draft.kind && item.title === draft.title);
  const next: Workstream = {
    id: current?.id ?? `work_${state.seq + 1}`,
    kind: draft.kind,
    title: draft.title,
    status: draft.status,
    summary: draft.summary,
    artifactPath: draft.artifactPath,
    updatedAt: new Date().toISOString(),
  };
  state.seq += 1;
  state.workstreams = [next, ...state.workstreams.filter((item) => item.id !== next.id)];
  store.persist(id);
  return next;
}

function writeNote(id: string, relativePath: string, contents: string) {
  const state = getStore().get(id);
  ensureWorkspace(state.workspaceId, state.title);
  writeWorkspaceFile(state.workspaceId, relativePath, contents);
  return relativePath;
}

function sentences(text: string) {
  return text
    .split(/[.。]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function executeWorkTool(name: string, args: Record<string, unknown>): ToolResult | null {
  if (!["plan_update", "design_draft", "verify_check", "research_collect", "preference_note", "suggest_surface"].includes(name)) {
    return null;
  }
  const id = meetingIdOf(args);
  const store = getStore();
  store.ensure(id);
  const text = textOf(args.text) || textOf(args.query);

  if (name === "plan_update") {
    const parts = sentences(text);
    const goal = parts[0] || text;
    const milestones = parts.slice(1);
    const body = [`# Plan`, "", `## Goal`, goal, "", `## Milestones`, ...(milestones.length ? milestones.map((item) => `- ${item}`) : ["- Still listening."]), ""].join("\n");
    const path = writeNote(id, "docs/plan.md", body);
    const card = upsert(id, {
      kind: "plan",
      title: "Plan",
      status: "ready",
      summary: goal,
      artifactPath: path,
    });
    store.addTrace(id, { tool: name, ok: true, summary: `Plan: ${goal}` });
    return { ok: true, summary: `Plan: ${goal}`, data: card };
  }

  if (name === "design_draft") {
    const kind = textOf(args.kind) || "architecture";
    const drafted = draftDesign(kind, text);
    const path = writeNote(id, drafted.path, drafted.body);
    const card = upsert(id, {
      kind: "design",
      title: drafted.title,
      status: "ready",
      summary: drafted.summary,
      artifactPath: path,
    });
    store.addTrace(id, { tool: name, ok: true, summary: drafted.summary });
    return { ok: true, summary: drafted.summary, data: card };
  }

  if (name === "verify_check") {
    const prior = relatedDecisions(text);
    const feasible = /nightly|export|job/i.test(text) || prior.length > 0;
    const body = [
      "# Feasibility",
      "",
      feasible ? "A nightly export fits the earlier decision. It stays off the request path." : "Nothing in memory contradicts this yet. Treat it as a check, not a proof.",
      "",
      "## Heard just now",
      text || "No detail.",
      "",
      "## Earlier decisions",
      ...(prior.length ? prior.map((item) => `- ${item}`) : ["- None matched."]),
      "",
    ].join("\n");
    const path = writeNote(id, "docs/feasibility.md", body);
    const summary = feasible ? "Feasible: a nightly job matches the earlier decision." : "Check recorded. No contradicting decision in memory.";
    const card = upsert(id, { kind: "verify", title: "Feasibility", status: "ready", summary, artifactPath: path });
    store.addTrace(id, { tool: name, ok: true, summary });
    return { ok: true, summary, data: card };
  }

  if (name === "research_collect") {
    const prior = relatedDecisions(text);
    const prefs = listPreferences().filter((item) => /export|nightly|billing/i.test(`${item.key} ${item.value}`) || /export|nightly|billing/i.test(text));
    const body = [
      "# Research",
      "",
      "Collected from this team's meetings and saved preferences. No live web lookup in mock mode.",
      "",
      "## Query",
      text || "What did we already decide?",
      "",
      "## Decisions",
      ...(prior.length ? prior.map((item) => `- ${item}`) : ["- No earlier decision matched."]),
      "",
      "## Preferences",
      ...(prefs.length ? prefs.map((item) => `- ${item.value}`) : ["- No saved preference matched."]),
      "",
    ].join("\n");
    const path = writeNote(id, "docs/research.md", body);
    const summary = prior[0] ? `Reference: ${prior[0]}` : "Research card is up. Nothing earlier matched that question.";
    const card = upsert(id, { kind: "research", title: "Research", status: "ready", summary, artifactPath: path });
    store.addTrace(id, { tool: name, ok: true, summary });
    return { ok: true, summary, data: card };
  }

  if (name === "preference_note") {
    const value = text.replace(/^(we prefer|we always|remember that we)\s*/i, "").trim() || text;
    savePreference({ key: "noted", value, sourceMeetingId: id });
    store.addTrace(id, { tool: name, ok: true, summary: `Preference saved: ${value}` });
    return { ok: true, summary: `Preference saved: ${value}` };
  }

  if (name === "suggest_surface") {
    const prior = relatedDecisions(text);
    const prefs = listPreferences();
    const hit = prior[0] || prefs.find((item) => /export|nightly|billing/i.test(text) && /export|nightly/i.test(item.value))?.value;
    if (!hit) {
      store.addTrace(id, { tool: name, ok: true, summary: "No earlier decision to surface." });
      return { ok: true, summary: "No earlier decision to surface." };
    }
    const suggestion = `From earlier: ${hit}`;
    const state = store.get(id);
    state.suggestions = [{ id: `sug_${state.seq + 1}`, text: suggestion, at: new Date().toISOString() }, ...state.suggestions].slice(0, 6);
    state.seq += 1;
    store.persist(id);
    store.addTrace(id, { tool: name, ok: true, summary: suggestion });
    return { ok: true, summary: suggestion };
  }

  return null;
}

function relatedDecisions(text: string) {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3);
  const interesting = new Set(["billing", "export", "nightly", "invoice", "job", "flag", "runbook"]);
  const hits: string[] = [];
  for (const meeting of listMeetings()) {
    for (const decision of meeting.decisions) {
      const hay = decision.text.toLowerCase();
      const matched = tokens.some((token) => interesting.has(token) && hay.includes(token));
      if (matched) hits.push(`${decision.text} (${meeting.title})`);
    }
  }
  return hits;
}

function draftDesign(kind: string, text: string): { title: string; path: string; summary: string; body: string } {
  if (kind === "wireframe") {
    return {
      title: "Settings wireframe",
      path: "design/export-settings.svg",
      summary: "Wireframe: nightly toggle and last-run time.",
      body: wireframeSvg(),
    };
  }
  if (kind === "api") {
    return {
      title: "API spec",
      path: "docs/api-exports.md",
      summary: "API spec: POST /exports starts a nightly export.",
      body: ["# POST /exports", "", "Starts a nightly billing export. It does not run on the request path.", "", "## Body", "- format: csv", "", "## Response", "- id", "- status: scheduled", "", "## From the room", text, ""].join("\n"),
    };
  }
  return {
    title: "Architecture",
    path: "design/architecture.svg",
    summary: "Architecture: export worker writes a CSV off the request path.",
    body: architectureSvg(),
  };
}

function architectureSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="280" viewBox="0 0 640 280">
  <rect width="640" height="280" fill="#10151c"/>
  <g font-family="ui-sans-serif,system-ui" font-size="14" fill="#f3efe6">
    <rect x="24" y="90" width="160" height="72" rx="12" fill="#1c2430" stroke="#e7b15a"/>
    <text x="104" y="132" text-anchor="middle">Invoices</text>
    <rect x="240" y="90" width="160" height="72" rx="12" fill="#1c2430" stroke="#9eb6ff"/>
    <text x="320" y="124" text-anchor="middle">Nightly worker</text>
    <text x="320" y="144" text-anchor="middle" font-size="11" fill="#9aa3b2">off the request path</text>
    <rect x="456" y="90" width="160" height="72" rx="12" fill="#1c2430" stroke="#5ddeaf"/>
    <text x="536" y="132" text-anchor="middle">CSV bucket</text>
    <path d="M184 126 H240" stroke="#c9d0da" stroke-width="2"/>
    <path d="M400 126 H456" stroke="#c9d0da" stroke-width="2"/>
  </g>
</svg>
`;
}

function wireframeSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="280" viewBox="0 0 420 280">
  <rect width="420" height="280" rx="16" fill="#f4f0e8"/>
  <text x="24" y="40" font-family="ui-sans-serif" font-size="16" fill="#1a1206">Export settings</text>
  <rect x="24" y="68" width="372" height="56" rx="10" fill="#fff" stroke="#d9d1c3"/>
  <text x="40" y="102" font-family="ui-sans-serif" font-size="14" fill="#1a1206">Nightly job</text>
  <rect x="320" y="84" width="52" height="28" rx="14" fill="#1f8a70"/>
  <circle cx="356" cy="98" r="10" fill="#fff"/>
  <rect x="24" y="140" width="372" height="56" rx="10" fill="#fff" stroke="#d9d1c3"/>
  <text x="40" y="174" font-family="ui-sans-serif" font-size="14" fill="#1a1206">Last run · 02:10</text>
</svg>
`;
}
