import { REPLIES } from "@/lib/demo-script";
import {
  evaluateTests,
  FIX_FILES,
  incidentDiff,
  incidentDiffText,
  lookupDeploy,
  pullRequestShell,
} from "@/lib/incident";
import { classifyUtterance } from "@/lib/classifier";
import { getStore } from "@/lib/meeting-store";
import { buildProgressReport } from "@/lib/progress";
import type { ConfirmAction, SpeakerId, ToolResult } from "@/lib/types";

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
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

function meetingIdOf(args: Record<string, unknown>) {
  return typeof args.meetingId === "string" && args.meetingId.trim() ? args.meetingId.trim() : "demo";
}

function speakerOf(value: unknown): SpeakerId | null {
  return value === "A" || value === "B" ? value : null;
}

function textOf(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finish(id: string, name: string, result: ToolResult): ToolResult {
  getStore().addTrace(id, { tool: name, ok: result.ok, summary: result.summary });
  return result;
}

function postmortem(id: string) {
  const state = getStore().get(id);
  const timeline = state.timeline
    .map((event) => `- ${event.timeLabel} ${event.title}. ${event.detail}`)
    .join("\n");
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

export function executeTool(name: string, args: Record<string, unknown> = {}): ToolResult {
  const id = meetingIdOf(args);
  const store = getStore();
  store.ensure(id);

  switch (name) {
    case "ingest_transcript": {
      const speaker = speakerOf(args.speaker);
      const text = textOf(args.text);
      if (!speaker || !text) {
        return finish(id, name, { ok: false, summary: "ingest_transcript needs speaker A or B and text." });
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
      const classification = classifyUtterance({ text, speaker, pending: state.pending });
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
        metrics: Array.isArray(args.metrics) ? args.metrics : undefined,
      });
      return finish(id, name, {
        ok: true,
        summary: `${timeLabel} ${title}`,
        data: event,
      });
    }
    case "timeline_correlate": {
      const fromTime = textOf(args.fromTime);
      const toTime = textOf(args.toTime);
      const note = textOf(args.note) || "Linked on the timeline.";
      const linked = store.correlate(id, fromTime, toTime, note);
      if (!linked.ok) {
        return finish(id, name, { ok: false, summary: `Could not link ${fromTime} to ${toTime}.` });
      }
      return finish(id, name, { ok: true, summary: note, data: { from: linked.from, to: linked.to, note } });
    }
    case "chatter_park": {
      const speaker = speakerOf(args.speaker);
      const text = textOf(args.text);
      if (!speaker || !text) {
        return finish(id, name, { ok: false, summary: "chatter_park needs speaker and text." });
      }
      const item = store.parkChatter(id, speaker, text);
      return finish(id, name, { ok: true, summary: "Parked in chatter.", data: item });
    }
    case "deploy_lookup": {
      const query = textOf(args.query) || "reconciliation batch";
      const deploy = lookupDeploy(query);
      if (!deploy) {
        return finish(id, name, { ok: false, summary: `No deploy matched “${query}”.` });
      }
      store.setDeploy(id, deploy);
      return finish(id, name, {
        ok: true,
        summary: `${deploy.service} ${deploy.version} deployed at ${deploy.deployedLabel}.`,
        data: deploy,
      });
    }
    case "diff_fetch": {
      const files = incidentDiff();
      store.setIncidentDiff(id, files);
      store.clearPending(id);
      return finish(id, name, {
        ok: true,
        summary: REPLIES.diff,
        data: { files, unified: incidentDiffText() },
      });
    }
    case "decision_record": {
      const speaker = speakerOf(args.speaker);
      const text = textOf(args.text);
      if (!speaker || !text) {
        return finish(id, name, { ok: false, summary: "decision_record needs speaker and text." });
      }
      const requirements = Array.isArray(args.requirements)
        ? args.requirements.filter((item): item is string => typeof item === "string")
        : [];
      const recorded = store.recordDecision(id, speaker, text, requirements);
      return finish(id, name, {
        ok: true,
        summary: "Decision recorded.",
        data: recorded,
      });
    }
    case "confirm_ask": {
      if (args.action === "clear") {
        store.clearPending(id);
        return finish(id, name, { ok: true, summary: "Pending confirmation cleared.", data: { pending: null } });
      }
      const action = args.action;
      const prompt = textOf(args.prompt);
      if (action !== "diff_fetch" && action !== "pr_draft" && action !== "write_doc") {
        return finish(id, name, { ok: false, summary: "confirm_ask needs a known action." });
      }
      if (!prompt) {
        return finish(id, name, { ok: false, summary: "confirm_ask needs a prompt." });
      }
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
      if (!speaker || !text) {
        return finish(id, name, { ok: false, summary: "todo_add needs speaker and text." });
      }
      const item = store.addTodo(id, speaker, text);
      return finish(id, name, { ok: true, summary: `Action item captured: ${text}`, data: item });
    }
    case "requirement_add": {
      const speaker = speakerOf(args.speaker);
      const text = textOf(args.text);
      if (!speaker || !text) {
        return finish(id, name, { ok: false, summary: "requirement_add needs speaker and text." });
      }
      const item = store.addRequirement(id, speaker, text);
      return finish(id, name, { ok: true, summary: `Requirement captured: ${text}`, data: item });
    }
    case "write_doc": {
      const customTitle = textOf(args.title);
      const customBody = textOf(args.body);
      const doc = customTitle
        ? store.writeDoc(id, customTitle, customBody || customTitle)
        : store.writeDoc(id, postmortem(id).title, postmortem(id).body);
      return finish(id, name, { ok: true, summary: `Doc written: ${doc.title}`, data: doc });
    }
    case "scaffold_code": {
      const files = FIX_FILES.map((file) => ({ ...file }));
      store.setScaffold(id, files);
      return finish(id, name, {
        ok: true,
        summary: `Scaffolded ${files.length} files.`,
        data: { files },
      });
    }
    case "pr_draft": {
      const state = store.get(id);
      if (!state.scaffold) {
        store.setScaffold(id, FIX_FILES.map((file) => ({ ...file })));
      }
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
    case "run_tests": {
      const state = store.get(id);
      const tests = evaluateTests(state.scaffold);
      if (state.pullRequest) {
        store.setPullRequest(id, { ...state.pullRequest, tests });
      }
      const passed = tests.every((test) => test.passed);
      return finish(id, name, {
        ok: true,
        summary: passed ? "Tests passing." : "Tests failing.",
        data: { tests, passed },
      });
    }
    case "report_progress": {
      const text = buildProgressReport(store.get(id));
      const report = store.addProgress(id, text);
      return finish(id, name, { ok: true, summary: text, data: report });
    }
    case "checkpoint_rollback": {
      const restored = store.rollback(id);
      const summary = restored.restored
        ? REPLIES.interrupt
        : "Nothing to roll back yet. What do you want instead?";
      return finish(id, name, { ok: true, summary, data: restored });
    }
    default:
      return { ok: false, summary: `Unknown tool: ${name}` };
  }
}

export function toolDefinitions() {
  const meetingId = { type: "string", description: "Meeting id. Defaults to demo." };
  const speaker = { type: "string", enum: ["A", "B"], description: "Speaker label. A or B in the demo." };
  return [
    def("ingest_transcript", "Store one utterance in the live transcript.", {
      meetingId,
      speaker,
      text: { type: "string" },
      kind: { type: "string" },
    }, ["speaker", "text"]),
    def("classify_utterance", "Classify an utterance as event, decision, requirement, todo, chatter, or a confirmation.", {
      meetingId,
      speaker,
      text: { type: "string" },
    }, ["speaker", "text"]),
    def("timeline_add", "Add a timestamped incident mark to the timeline.", {
      meetingId,
      speaker,
      timeLabel: { type: "string", description: "Clock label such as 02:17." },
      title: { type: "string" },
      detail: { type: "string" },
      metrics: { type: "array" },
    }, ["speaker", "timeLabel", "title"]),
    def("timeline_correlate", "Link two timeline marks and record why they belong together.", {
      meetingId,
      fromTime: { type: "string" },
      toTime: { type: "string" },
      note: { type: "string" },
    }, ["fromTime", "toTime"]),
    def("chatter_park", "Park side conversation in the chatter column, away from the requirement pool.", {
      meetingId,
      speaker,
      text: { type: "string" },
    }, ["speaker", "text"]),
    def("deploy_lookup", "Look up a production deploy. The 2:17 AM incident involves batch-reconcile v2.3 at 11:40 PM.", {
      meetingId,
      query: { type: "string" },
    }, ["query"]),
    def("diff_fetch", "Fetch the batch-reconcile v2.3 diff. Highlights max_connections 50 to 20 and the missing timeout.", {
      meetingId,
    }),
    def("decision_record", "Record a decision and any requirements that fall out of it.", {
      meetingId,
      speaker,
      text: { type: "string" },
      requirements: { type: "array", items: { type: "string" } },
    }, ["speaker", "text"]),
    def("confirm_ask", "Ask the room to confirm a large action before Talk2Build does it.", {
      meetingId,
      action: { type: "string", enum: ["diff_fetch", "pr_draft", "write_doc", "clear"] },
      prompt: { type: "string" },
      payload: { type: "object" },
    }, ["action", "prompt"]),
    def("todo_add", "Capture an action item.", {
      meetingId,
      speaker,
      text: { type: "string" },
    }, ["speaker", "text"]),
    def("requirement_add", "File a requirement in the pool, attributed to the speaker.", {
      meetingId,
      speaker,
      text: { type: "string" },
    }, ["speaker", "text"]),
    def("write_doc", "Write a doc immediately. Small writing does not wait for confirmation. Omit title to draft the postmortem.", {
      meetingId,
      title: { type: "string" },
      body: { type: "string" },
    }),
    def("scaffold_code", "Scaffold the Redis pool fix: restored pool, timeout, alert, and feature flag.", {
      meetingId,
    }),
    def("pr_draft", "Open a draft pull request from the scaffolded fix.", {
      meetingId,
    }),
    def("run_tests", "Run the fix tests against the scaffolded files and attach the results to the draft PR.", {
      meetingId,
    }),
    def("report_progress", "Speak a short progress line: requirements, decisions, the PR, and tests.", {
      meetingId,
    }),
    def("checkpoint_rollback", "Roll the meeting back to the last checkpoint after stop or 不对.", {
      meetingId,
    }),
  ];
}

function def(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: true,
    },
    annotations: {
      readOnlyHint: ["deploy_lookup", "diff_fetch", "classify_utterance", "report_progress", "run_tests"].includes(name),
      destructiveHint: name === "checkpoint_rollback",
    },
  };
}
