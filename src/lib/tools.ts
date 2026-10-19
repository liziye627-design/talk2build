import { GAME_PAGE_PATH, gameJamFiles, isGameJamMeeting } from "@/lib/agent/game-jam";
import { spawnSync } from "node:child_process";
import { classifyUtterance } from "@/lib/classifier";
import { addArtifact, ensureWorkspace, listMeetings, nid } from "@/lib/db";
import { REPLIES } from "@/lib/demo-script";
import {
  evaluateTests,
  FIX_FILES,
  incidentDiff,
  incidentDiffText,
  lookupDeploy,
  pullRequestShell,
} from "@/lib/incident";
import { emptyMeeting, getStore } from "@/lib/meeting-store";
import { renderCompletion, renderMinutes } from "@/lib/minutes";
import { buildProgressReport } from "@/lib/progress";
import { isOnYesterday } from "@/lib/time";
import type { ConfirmAction, DiffFile, ScaffoldFile, TestResult, ToolResult } from "@/lib/types";
import { listWorkspaceFiles, readWorkspaceFile, workspaceDir, writeWorkspaceFile } from "@/lib/workspace";
import { executeWorkTool } from "@/lib/work-tools";

export const TOOL_NAMES = [
  "ingest_transcript",
  "classify_utterance",
  "timeline_add",
  "timeline_correlate",
  "chatter_park",
  "deploy_lookup",
  "diff_fetch",
  "decision_record",
  "confirm_ask",
  "todo_add",
  "requirement_add",
  "write_doc",
  "scaffold_code",
  "pr_draft",
  "run_tests",
  "report_progress",
  "checkpoint_rollback",
  "search_memory",
  "create_issues",
  "meeting_summary",
  "meeting_open",
  "list_workspace",
  "read_file",
  "write_file",
  "plan_update",
  "design_draft",
  "verify_check",
  "research_collect",
  "preference_note",
  "suggest_surface",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

const CONFIRM_ACTIONS = new Set<string>([
  "diff_fetch",
  "pr_draft",
  "write_doc",
  "create_issues",
  "scaffold_code",
  "run_tests",
  "confirm_conclusion",
  "clear",
]);

function meetingIdOf(args: Record<string, unknown>) {
  return typeof args.meetingId === "string" && args.meetingId.trim() ? args.meetingId.trim() : "demo";
}

function speakerOf(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 64) return null;
  return text;
}

function textOf(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function threadOf(id: string, args: Record<string, unknown>) {
  const explicit = textOf(args.threadId);
  if (explicit) return explicit;
  return getStore().get(id).threadId;
}

function finish(id: string, name: string, result: ToolResult): ToolResult {
  getStore().addTrace(id, { tool: name, ok: result.ok, summary: result.summary });
  return result;
}

function incidentMeeting(id: string) {
  return getStore().get(id).scenario === "incident";
}

function slug(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42);
  return cleaned || "note";
}

function remember(id: string, args: Record<string, unknown>, relativePath: string, title: string, kind: string) {
  const state = getStore().get(id);
  addArtifact({
    threadId: threadOf(id, args),
    meetingId: id,
    workspaceId: state.workspaceId,
    path: relativePath,
    title,
    kind,
  });
}

function writeTracked(id: string, args: Record<string, unknown>, relativePath: string, contents: string, title: string, kind: string) {
  const state = getStore().get(id);
  ensureWorkspace(state.workspaceId, state.title);
  writeWorkspaceFile(state.workspaceId, relativePath, contents);
  remember(id, args, relativePath, title, kind);
}

function postmortem(id: string) {
  const state = getStore().get(id);
  const timeline = state.timeline.map((event) => `- ${event.timeLabel} ${event.title}. ${event.detail}`).join("\n");
  const decision = state.decisions[0]?.text ?? "Root cause not recorded yet.";
  const requirements = state.requirements.map((item) => `- ${item.text}`).join("\n");
  return {
    title: "Orders service postmortem — 2:17 AM",
    body: [
      "# Orders service postmortem — 2:17 AM",
      "",
      "Morning review of the overnight outage. Talk2Build logged this while the room talked.",
      "",
      "## Timeline",
      timeline || "- No marks yet.",
      "",
      "## Decision",
      decision,
      "",
      "## Requirements",
      requirements || "- None yet.",
      "",
      "## Deploy",
      state.deploy
        ? `${state.deploy.service} ${state.deploy.version} at ${state.deploy.deployedLabel} (${state.deploy.commit}).`
        : "Deploy not identified.",
    ].join("\n"),
  };
}

function filesFromArgs(value: unknown): ScaffoldFile[] | null {
  if (!Array.isArray(value)) return null;
  const files: ScaffoldFile[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as { path?: unknown; contents?: unknown };
    if (typeof record.path === "string" && typeof record.contents === "string") {
      files.push({ path: record.path, contents: record.contents });
    }
  }
  return files.length > 0 ? files : null;
}

function moduleFromPrompt(prompt: string): ScaffoldFile[] {
  const name = slug(prompt);
  return [
    {
      path: `src/${name}.mjs`,
      contents: `export function describeTask() {\n  return ${JSON.stringify(prompt)};\n}\n`,
    },
    {
      path: `test/${name}.test.mjs`,
      contents: [
        `import test from "node:test";`,
        `import assert from "node:assert/strict";`,
        `import { describeTask } from "../src/${name}.mjs";`,
        ``,
        `test("describes the task", () => {`,
        `  assert.equal(typeof describeTask(), "string");`,
        `  assert.ok(describeTask().length > 0);`,
        `});`,
        ``,
      ].join("\n"),
    },
  ];
}

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 4000 });
  if (result.status !== 0) return null;
  return (result.stdout || "").trim();
}

function runNodeTests(cwd: string): { tests: TestResult[]; passed: boolean } {
  const result = spawnSync(process.execPath, ["--test"], { cwd, encoding: "utf8", timeout: 15_000 });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const tests: TestResult[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^(ok|not ok) \d+ - (.*)$/);
    if (!match?.[1] || !match[2]) continue;
    tests.push({ name: match[2], passed: match[1] === "ok", detail: line });
  }
  return { tests, passed: tests.length > 0 && tests.every((test) => test.passed) && result.status === 0 };
}

function searchMemory(args: Record<string, unknown>): ToolResult {
  const since = textOf(args.since);
  const query = textOf(args.query);
  const wantTodos = /todo|action|issue/i.test(query);
  const decisions: { meeting: string; text: string; speaker: string; at: string }[] = [];
  const todos: { meeting: string; text: string; done: boolean }[] = [];
  for (const meeting of listMeetings()) {
    for (const decision of meeting.decisions) {
      if (since === "yesterday" && !isOnYesterday(decision.at)) continue;
      decisions.push({ meeting: meeting.title, text: decision.text, speaker: decision.speaker, at: decision.at });
    }
    if (wantTodos || since !== "yesterday") {
      for (const todo of meeting.todos) {
        if (since === "yesterday" && !isOnYesterday(todo.at)) continue;
        todos.push({ meeting: meeting.title, text: todo.text, done: todo.done });
      }
    }
  }
  if (decisions.length === 0 && todos.length === 0) {
    const empty = since === "yesterday" ? "I don't have a decision from yesterday yet." : "Nothing in memory matched that.";
    return { ok: true, summary: empty, data: { decisions, todos } };
  }
  const lead = since === "yesterday" ? "Yesterday's decision" : "Decision";
  const decisionLine = decisions.length > 0 ? `${lead}: ${decisions.map((item) => item.text).join(" ")}` : "";
  const openTodos = todos.filter((item) => !item.done);
  const todoLine = openTodos.length > 0 ? `Open action items: ${openTodos.map((item) => item.text).join("; ")}.` : "";
  return { ok: true, summary: [decisionLine, todoLine].filter(Boolean).join(" "), data: { decisions, todos } };
}

function createIssues(args: Record<string, unknown>, fallbackId: string): ToolResult {
  const scanAll = args.scope === "all" || !textOf(args.meetingId);
  const targetId = textOf(args.meetingId) || fallbackId;
  const meetings = listMeetings().filter((meeting) => (scanAll ? true : meeting.id === targetId));
  const store = getStore();
  const written: string[] = [];
  for (const meeting of meetings) {
    const open = meeting.todos.filter((todo) => !todo.done);
    if (open.length === 0) continue;
    open.forEach((todo, index) => {
      const relativePath = `issues/${String(index + 1).padStart(2, "0")}-${slug(todo.text)}.md`;
      const body = [`# ${todo.text}`, "", `From: ${meeting.title}`, `Owner: ${todo.speaker}`, "", "Status: open", ""].join("\n");
      writeTracked(meeting.id, { ...args, meetingId: meeting.id }, relativePath, body, todo.text, "issue");
      written.push(todo.text);
    });
    const live = store.ensure(meeting.id);
    for (const todo of live.todos) {
      if (!todo.done && open.some((item) => item.id === todo.id)) todo.done = true;
    }
    store.persist(meeting.id);
  }
  const traceId = meetings[0]?.id || fallbackId || "demo";
  if (written.length === 0) {
    return finish(traceId, "create_issues", { ok: true, summary: "No open action items to turn into issues.", data: { issues: [] } });
  }
  return finish(traceId, "create_issues", {
    ok: true,
    summary: `${written.length === 1 ? "One issue" : `${written.length} issues`} written to the workspace: ${written.join("; ")}.`,
    data: { issues: written },
  });
}

function openMeeting(args: Record<string, unknown>): ToolResult {
  const store = getStore();
  const meetingId = nid("mtg");
  const created = emptyMeeting(meetingId);
  created.title = textOf(args.title) || "Working session";
  created.scenario = args.scenario === "incident" ? "incident" : "general";
  created.status = "live";
  const host = textOf(args.host) || "You";
  created.participants =
    created.scenario === "incident"
      ? [
          { id: "pA", name: "Priya", label: "A", micOn: false, present: true },
          { id: "pB", name: "Jordan", label: "B", micOn: false, present: true },
        ]
      : [{ id: nid("p"), name: host, label: host, micOn: false, present: true }];
  if (Array.isArray(args.team)) {
    for (const name of args.team) {
      if (typeof name !== "string" || !name.trim()) continue;
      const label = name.trim();
      if (created.participants.some((person) => person.label === label)) continue;
      created.participants.push({ id: nid("p"), name: label, label, micOn: false, present: true });
    }
  }
  const linked = textOf(args.threadId);
  if (linked) created.threadId = linked;
  ensureWorkspace(created.workspaceId, created.title);
  store.adopt(created);
  return finish(meetingId, "meeting_open", {
    ok: true,
    summary: `Meeting “${created.title}” is live. Join code ${created.joinCode}.`,
    data: { meetingId: created.id, joinCode: created.joinCode, title: created.title },
  });
}

function diffFromScaffold(files: ScaffoldFile[]): DiffFile[] {
  return files.map((file) => ({
    path: file.path,
    language: file.path.endsWith(".py") ? "python" : file.path.endsWith(".yaml") || file.path.endsWith(".yml") ? "yaml" : "text",
    lines: file.contents.split("\n").map((text) => ({ type: "add" as const, text, highlight: "fix" as const })),
  }));
}

export function executeTool(name: string, args: Record<string, unknown> = {}): ToolResult {
  const worked = executeWorkTool(name, args);
  if (worked) return worked;
  if (name === "search_memory") return searchMemory(args);
  if (name === "meeting_open") return openMeeting(args);
  if (name === "create_issues" && args.scope === "all") return createIssues(args, "");
  const id = meetingIdOf(args);
  const store = getStore();
  store.ensure(id);

  switch (name) {
    case "ingest_transcript": {
      const speaker = speakerOf(args.speaker);
      const text = textOf(args.text);
      if (!speaker || !text) {
        return finish(id, name, { ok: false, summary: "ingest_transcript needs a speaker and text." });
      }
      const entry = store.ingest(id, {
        speaker,
        text,
        kind: typeof args.kind === "string" ? args.kind : undefined,
      });
      return finish(id, name, { ok: true, summary: `Transcript line ${entry.id} stored.`, data: entry });
    }
    case "classify_utterance": {
      const speaker = speakerOf(args.speaker);
      const text = textOf(args.text);
      if (!speaker || !text) {
        return finish(id, name, { ok: false, summary: "classify_utterance needs speaker and text." });
      }
      const state = store.get(id);
      const classification = classifyUtterance({
        text,
        speaker,
        pending: state.pending,
        queue: state.confirmQueue,
        scenario: state.scenario,
      });
      store.stampKind(id, text, classification.kind);
      return finish(id, name, {
        ok: true,
        summary: `Classified as ${classification.kind}.`,
        data: { kind: classification.kind, summary: classification.summary, silent: classification.silent },
      });
    }
    case "timeline_add": {
      const speaker = speakerOf(args.speaker);
      const timeLabel = textOf(args.timeLabel);
      const title = textOf(args.title);
      const detail = textOf(args.detail);
      if (!speaker || !timeLabel || !title) {
        return finish(id, name, { ok: false, summary: "timeline_add needs speaker, timeLabel, and title." });
      }
      const event = store.addTimeline(id, {
        speaker,
        timeLabel,
        title,
        detail: detail || title,
        metrics: Array.isArray(args.metrics) ? (args.metrics as never) : undefined,
      });
      return finish(id, name, { ok: true, summary: `${timeLabel} ${title}`, data: event });
    }
    case "timeline_correlate": {
      const fromTime = textOf(args.fromTime);
      const toTime = textOf(args.toTime);
      const note = textOf(args.note) || "Linked on the timeline.";
      const linked = store.correlate(id, fromTime, toTime, note);
      if (!linked.ok) return finish(id, name, { ok: false, summary: `Could not link ${fromTime} to ${toTime}.` });
      return finish(id, name, { ok: true, summary: note, data: { from: linked.from, to: linked.to, note } });
    }
    case "chatter_park": {
      const speaker = speakerOf(args.speaker);
      const text = textOf(args.text);
      if (!speaker || !text) return finish(id, name, { ok: false, summary: "chatter_park needs speaker and text." });
      const item = store.parkChatter(id, speaker, text);
      return finish(id, name, { ok: true, summary: "Parked in chatter.", data: item });
    }
    case "deploy_lookup": {
      const query = textOf(args.query) || "reconciliation batch";
      if (incidentMeeting(id)) {
        const deploy = lookupDeploy(query);
        if (!deploy) return finish(id, name, { ok: false, summary: `No deploy matched “${query}”.` });
        store.setDeploy(id, deploy);
        return finish(id, name, {
          ok: true,
          summary: `${deploy.service} ${deploy.version} deployed at ${deploy.deployedLabel}.`,
          data: deploy,
        });
      }
      const cwd = workspaceDir(store.get(id).workspaceId);
      const latest = git(cwd, ["log", "-1", "--pretty=format:%h %s"]);
      if (!latest) {
        return finish(id, name, { ok: true, summary: `No deploy matched “${query}” in this workspace.`, data: null });
      }
      return finish(id, name, { ok: true, summary: `Latest commit in the workspace: ${latest}.`, data: { commit: latest } });
    }
    case "diff_fetch": {
      if (!incidentMeeting(id)) {
        const cwd = workspaceDir(store.get(id).workspaceId);
        const diff = git(cwd, ["diff", "--stat"]);
        store.clearPending(id);
        return finish(id, name, {
          ok: true,
          summary: diff ? `Workspace diff: ${diff}` : "This workspace has no git diff yet.",
          data: { diff },
        });
      }
      const files = incidentDiff();
      store.setIncidentDiff(id, files);
      store.clearPending(id);
      return finish(id, name, { ok: true, summary: REPLIES.diff, data: { files, unified: incidentDiffText() } });
    }
    case "decision_record": {
      const speaker = speakerOf(args.speaker);
      const text = textOf(args.text);
      if (!speaker || !text) return finish(id, name, { ok: false, summary: "decision_record needs speaker and text." });
      const requirements = Array.isArray(args.requirements)
        ? args.requirements.filter((item): item is string => typeof item === "string")
        : [];
      const recorded = store.recordDecision(id, speaker, text, requirements);
      const conclusionId = textOf(args.conclusionId);
      if (conclusionId) {
        store.resolveConclusion(id, conclusionId, "confirmed", recorded.decision.id);
        store.clearPending(id, conclusionId);
      }
      return finish(id, name, { ok: true, summary: "Decision recorded.", data: recorded });
    }
    case "confirm_ask": {
      if (args.action === "clear") {
        const conclusionId = textOf(args.conclusionId);
        if (conclusionId) {
          store.resolveConclusion(id, conclusionId, "rejected");
          store.clearPending(id, conclusionId);
          return finish(id, name, { ok: true, summary: "Conclusion rejected.", data: { pending: store.get(id).pending } });
        }
        store.clearPending(id);
        return finish(id, name, { ok: true, summary: "Pending confirmation cleared.", data: { pending: null } });
      }
      const action = textOf(args.action);
      const prompt = textOf(args.prompt);
      if (!CONFIRM_ACTIONS.has(action)) return finish(id, name, { ok: false, summary: "confirm_ask needs a known action." });
      if (!prompt) return finish(id, name, { ok: false, summary: "confirm_ask needs a prompt." });
      const pending = store.askConfirm(id, {
        action: action as ConfirmAction,
        prompt,
        payload:
          args.payload && typeof args.payload === "object" && !Array.isArray(args.payload)
            ? (args.payload as Record<string, unknown>)
            : undefined,
      });
      return finish(id, name, { ok: true, summary: prompt, data: pending });
    }
    case "todo_add": {
      const speaker = speakerOf(args.speaker);
      const text = textOf(args.text);
      if (!speaker || !text) return finish(id, name, { ok: false, summary: "todo_add needs speaker and text." });
      const item = store.addTodo(id, speaker, text);
      return finish(id, name, { ok: true, summary: `Action item captured: ${text}`, data: item });
    }
    case "requirement_add": {
      const speaker = speakerOf(args.speaker);
      const text = textOf(args.text);
      if (!speaker || !text) return finish(id, name, { ok: false, summary: "requirement_add needs speaker and text." });
      const item = store.addRequirement(id, speaker, text);
      return finish(id, name, { ok: true, summary: `Requirement captured: ${text}`, data: item });
    }
    case "write_doc": {
      const customTitle = textOf(args.title);
      const customBody = textOf(args.body);
      const drafted = customTitle ? { title: customTitle, body: customBody || customTitle } : postmortem(id);
      const doc = store.writeDoc(id, drafted.title, drafted.body);
      const relativePath = `docs/${slug(drafted.title)}.md`;
      writeTracked(id, args, relativePath, drafted.body, drafted.title, "doc");
      return finish(id, name, { ok: true, summary: `Doc written: ${doc.title}`, data: { ...doc, path: relativePath } });
    }
    case "scaffold_code": {
      const supplied = filesFromArgs(args.files);
      const prompt = textOf(args.prompt);
      const files =
        supplied ??
        (incidentMeeting(id) && !prompt
          ? FIX_FILES.map((file) => ({ ...file }))
          : !incidentMeeting(id) && isGameJamMeeting(store.get(id))
            ? gameJamFiles(store.get(id))
            : moduleFromPrompt(prompt || "workspace task"));
      const gameJam = !incidentMeeting(id) && !supplied && isGameJamMeeting(store.get(id));
      store.setScaffold(id, files);
      for (const file of files) writeTracked(id, args, file.path, file.contents, file.path, "code");
      if (!incidentMeeting(id)) {
        const patch = files
          .map((file) => {
            const added = file.contents.split("\n").map((line) => `+${line}`).join("\n");
            return `diff --git a/${file.path} b/${file.path}\nnew file mode 100644\n--- /dev/null\n+++ b/${file.path}\n${added}\n`;
          })
          .join("\n");
        writeTracked(id, args, "docs/patch.diff", patch, "PR-ready patch", "patch");
        store.setPullRequest(id, {
          title: `${store.get(id).title} draft`,
          body: "Drafted from the workspace scaffold. Review before opening it upstream.",
          branch: "talk2build/task",
          base: "main",
          files: diffFromScaffold(files),
          tests: [],
          status: "draft",
        });
      }
      const jobId = textOf(args.jobId);
      const streams = store.get(id).workstreams;
      const waiting = jobId
        ? streams.find((item) => item.kind === "code" && item.jobId === jobId)
        : streams.find((item) => item.kind === "code" && (item.status === "waiting" || item.status === "working"));
      if (waiting) {
        waiting.status = "ready";
        waiting.summary = gameJam
          ? `Spec written from the meeting, prototype scaffolded from the template: ${files.length} files.`
          : `Scaffolded ${files.length} files.`;
        waiting.progress = "Saved";
        waiting.artifactPath = gameJam ? GAME_PAGE_PATH : "docs/patch.diff";
        waiting.updatedAt = new Date().toISOString();
        store.persist(id);
      }
      store.clearPending(id, jobId || undefined);
      return finish(id, name, { ok: true, summary: `Scaffolded ${files.length} files.`, data: { files } });
    }
    case "pr_draft": {
      const state = store.get(id);
      if (incidentMeeting(id)) {
        if (!state.scaffold) store.setScaffold(id, FIX_FILES.map((file) => ({ ...file })));
        const shell = pullRequestShell();
        const tests = evaluateTests(store.get(id).scaffold);
        const pullRequest = { ...shell, tests };
        store.setPullRequest(id, pullRequest);
        store.clearPending(id);
        return finish(id, name, {
          ok: true,
          summary: `PR draft ready. ${pullRequest.files.length} files changed.`,
          data: pullRequest,
        });
      }
      const files = state.scaffold ?? [];
      const pullRequest = {
        title: textOf(args.title) || `${state.title} draft`,
        body: "Drafted from the workspace scaffold. Review before opening it upstream.",
        branch: "talk2build/task",
        base: "main",
        files: diffFromScaffold(files),
        tests: [] as TestResult[],
        status: "draft" as const,
      };
      store.setPullRequest(id, pullRequest);
      store.clearPending(id);
      return finish(id, name, {
        ok: true,
        summary: `PR draft ready. ${pullRequest.files.length} files changed.`,
        data: pullRequest,
      });
    }
    case "run_tests": {
      const state = store.get(id);
      if (incidentMeeting(id)) {
        const tests = evaluateTests(state.scaffold);
        if (state.pullRequest) store.setPullRequest(id, { ...state.pullRequest, tests });
        const passed = tests.every((test) => test.passed);
        store.clearPending(id);
        return finish(id, name, { ok: true, summary: passed ? "Tests passing." : "Tests failing.", data: { tests, passed } });
      }
      ensureWorkspace(state.workspaceId, state.title);
      const result = runNodeTests(workspaceDir(state.workspaceId));
      if (state.pullRequest) store.setPullRequest(id, { ...store.get(id).pullRequest!, tests: result.tests });
      store.clearPending(id);
      return finish(id, name, {
        ok: true,
        summary: result.passed ? "Tests passing." : result.tests.length === 0 ? "No tests found." : "Tests failing.",
        data: result,
      });
    }
    case "report_progress": {
      const text = buildProgressReport(store.get(id));
      const report = store.addProgress(id, text);
      return finish(id, name, { ok: true, summary: text, data: report });
    }
    case "checkpoint_rollback": {
      const restored = store.rollback(id);
      const summary = restored.restored ? REPLIES.interrupt : "Nothing to roll back yet. What do you want instead?";
      return finish(id, name, { ok: true, summary, data: restored });
    }
    case "create_issues":
      return createIssues(args, id);
    case "meeting_summary": {
      const state = store.get(id);
      if (textOf(args.ended) === "true") state.status = "ended";
      const minutes = renderMinutes(state);
      const title = `${state.title} minutes`;
      store.writeDoc(id, title, minutes);
      const relativePath = "docs/minutes.md";
      writeTracked(id, args, relativePath, minutes, title, "minutes");
      writeTracked(id, args, "docs/completion.md", renderCompletion(state), "Completion report", "completion");
      const current = store.get(id);
      current.summary = { title, minutes, at: new Date().toISOString() };
      store.persist(id);
      return finish(id, name, { ok: true, summary: `Minutes written for ${state.title}.`, data: current.summary });
    }
    case "meeting_open":
      return openMeeting(args);
    case "list_workspace": {
      const files = listWorkspaceFiles(store.get(id).workspaceId);
      return finish(id, name, {
        ok: true,
        summary: files.length === 0 ? "Workspace is empty." : `${files.length} files in the workspace.`,
        data: { files },
      });
    }
    case "read_file": {
      const relativePath = textOf(args.path);
      if (!relativePath) return finish(id, name, { ok: false, summary: "read_file needs a path." });
      try {
        const contents = readWorkspaceFile(store.get(id).workspaceId, relativePath);
        return finish(id, name, { ok: true, summary: `Read ${relativePath}.`, data: { path: relativePath, contents } });
      } catch (error) {
        return finish(id, name, { ok: false, summary: error instanceof Error ? error.message : "Could not read the file." });
      }
    }
    case "write_file": {
      const relativePath = textOf(args.path);
      const contents = typeof args.contents === "string" ? args.contents : "";
      if (!relativePath || !contents) return finish(id, name, { ok: false, summary: "write_file needs a path and contents." });
      try {
        writeTracked(id, args, relativePath, contents, relativePath, "file");
        return finish(id, name, { ok: true, summary: `Wrote ${relativePath}.`, data: { path: relativePath } });
      } catch (error) {
        return finish(id, name, { ok: false, summary: error instanceof Error ? error.message : "Could not write the file." });
      }
    }
    default:
      return { ok: false, summary: `Unknown tool: ${name}` };
  }
}

export function toolDefinitions() {
  const meetingId = { type: "string", description: "Meeting id. Defaults to the incident demo." };
  const speaker = { type: "string", description: "Who is speaking. A label such as A, B, or a participant name." };
  const threadId = { type: "string", description: "Task thread that should receive artifacts." };
  return [
    def("ingest_transcript", "Store one utterance in the live transcript.", { meetingId, speaker, text: { type: "string" }, kind: { type: "string" } }, ["speaker", "text"]),
    def("classify_utterance", "Classify an utterance as event, decision, requirement, todo, chatter, or a confirmation.", { meetingId, speaker, text: { type: "string" } }, ["speaker", "text"]),
    def("timeline_add", "Add a timestamped mark to the timeline.", { meetingId, speaker, timeLabel: { type: "string" }, title: { type: "string" }, detail: { type: "string" }, metrics: { type: "array" } }, ["speaker", "timeLabel", "title"]),
    def("timeline_correlate", "Link two timeline marks and record why they belong together.", { meetingId, fromTime: { type: "string" }, toTime: { type: "string" }, note: { type: "string" } }, ["fromTime", "toTime"]),
    def("chatter_park", "Park side conversation away from the requirement pool.", { meetingId, speaker, text: { type: "string" } }, ["speaker", "text"]),
    def("deploy_lookup", "Look up a deploy. Incident meetings use the 2:17 AM fixture. Other workspaces use git log when the folder is a repository.", { meetingId, query: { type: "string" } }, ["query"]),
    def("diff_fetch", "Fetch a diff. Incident meetings return the batch-reconcile pool shrink. Other workspaces return git diff --stat.", { meetingId }),
    def("decision_record", "Record a decision and any requirements that fall out of it.", { meetingId, speaker, text: { type: "string" }, requirements: { type: "array", items: { type: "string" } } }, ["speaker", "text"]),
    def("confirm_ask", "Ask before a large action: pulling a diff, opening a PR, scaffolding, running tests, or creating issues.", { meetingId, action: { type: "string", enum: [...CONFIRM_ACTIONS] }, prompt: { type: "string" }, payload: { type: "object" } }, ["action", "prompt"]),
    def("todo_add", "Capture an action item.", { meetingId, speaker, text: { type: "string" } }, ["speaker", "text"]),
    def("requirement_add", "File a requirement in the pool, attributed to the speaker.", { meetingId, speaker, text: { type: "string" } }, ["speaker", "text"]),
    def("write_doc", "Write a markdown doc into the workspace immediately. Omit title on an incident meeting to draft the postmortem.", { meetingId, threadId, title: { type: "string" }, body: { type: "string" } }),
    def("scaffold_code", "Write files into the workspace. Incident meetings scaffold the Redis pool fix. Other meetings scaffold from files[] or a prompt.", { meetingId, threadId, prompt: { type: "string" }, files: { type: "array" } }),
    def("pr_draft", "Draft a pull request from the scaffold. A large action: confirm first unless the room already said yes.", { meetingId }),
    def("run_tests", "Run tests. Incident meetings use the fixture checks. Other workspaces run node --test.", { meetingId }),
    def("report_progress", "A short status line: requirements, decisions, the PR, and tests.", { meetingId }),
    def("checkpoint_rollback", "Roll the meeting back to the last checkpoint after stop or 不对.", { meetingId }),
    def("search_memory", "Search decisions, action items, and docs across meetings. Pass since=yesterday for the previous calendar day.", { meetingId, query: { type: "string" }, since: { type: "string" } }, ["query"]),
    def("create_issues", "Write one markdown issue per open action item. Confirm before creating them.", { meetingId, threadId }),
    def("meeting_summary", "Write minutes (decisions, action items, requirements, parked chatter) and attach them to the task.", { meetingId, threadId, ended: { type: "string" } }),
    def("meeting_open", "Open a live meeting and return its id and join code.", { title: { type: "string" }, host: { type: "string" }, scenario: { type: "string" }, threadId }),
    def("list_workspace", "List files in the meeting workspace.", { meetingId }),
    def("read_file", "Read a file from the meeting workspace. Paths cannot escape the workspace.", { meetingId, path: { type: "string" } }, ["path"]),
    def("write_file", "Write a file into the meeting workspace. Paths cannot escape the workspace.", { meetingId, threadId, path: { type: "string" }, contents: { type: "string" } }, ["path", "contents"]),
    def("plan_update", "Update the live plan card: goal, milestones, and tasks inferred from the room.", { meetingId, text: { type: "string" } }, ["text"]),
    def("design_draft", "Draft a design artifact while the room talks: architecture, wireframe, or api.", { meetingId, kind: { type: "string", enum: ["architecture", "wireframe", "api"] }, text: { type: "string" } }, ["kind", "text"]),
    def("verify_check", "Record a feasibility or fact check against earlier decisions. Running the suite still waits for a yes.", { meetingId, text: { type: "string" } }, ["text"]),
    def("research_collect", "Collect references from earlier meetings and saved preferences. Mock mode does not invent web citations.", { meetingId, query: { type: "string" } }, ["query"]),
    def("preference_note", "Remember a team preference for later meetings.", { meetingId, text: { type: "string" } }, ["text"]),
    def("suggest_surface", "Surface a timely suggestion from earlier decisions without being asked.", { meetingId, text: { type: "string" } }, ["text"]),
  ];
}

function def(name: string, description: string, properties: Record<string, unknown>, required: string[] = []) {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, required, additionalProperties: true },
    annotations: {
      readOnlyHint: ["deploy_lookup", "diff_fetch", "classify_utterance", "report_progress", "search_memory", "list_workspace", "read_file"].includes(name),
      destructiveHint: name === "checkpoint_rollback",
    },
  };
}
