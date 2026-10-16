import type { Debate, EvidenceReport, TechSelection } from "@/lib/evidence/types";

export const PROTOCOL_VERSION = "2025-11-25";

export type SpeakerId = string;

export type MeetingScenario = "general" | "incident";

export type MeetingStatus = "scheduled" | "live" | "ended";

export type UtteranceKind =
  | "event"
  | "correlation"
  | "deploy_query"
  | "confirm"
  | "reject"
  | "decision"
  | "todo"
  | "chatter"
  | "requirement"
  | "interrupt";

export interface TranscriptEntry {
  id: string;
  speaker: SpeakerId | "Alexa";
  text: string;
  at: string;
  kind?: string;
}

export interface RedisSample {
  t: string;
  connections: number;
  note?: string;
}

export interface TimelineEvent {
  id: string;
  timeLabel: string;
  title: string;
  detail: string;
  speaker: SpeakerId;
  linkedIds: string[];
  correlationNote?: string;
  metrics?: RedisSample[];
}

export interface Decision {
  id: string;
  text: string;
  speaker: SpeakerId;
  at: string;
}

export interface Requirement {
  id: string;
  text: string;
  speaker: SpeakerId;
  at: string;
}

export interface TodoItem {
  id: string;
  text: string;
  speaker: SpeakerId;
  done: boolean;
  at: string;
}

export interface ChatterItem {
  id: string;
  text: string;
  speaker: SpeakerId;
  at: string;
}

export interface DeployRecord {
  service: string;
  version: string;
  deployedAt: string;
  deployedLabel: string;
  author: string;
  environment: string;
  commit: string;
  summary: string;
}

export interface DiffLine {
  type: "add" | "del" | "ctx";
  text: string;
  highlight?: "shrink" | "missing-timeout" | "fix";
}

export interface DiffFile {
  path: string;
  language: string;
  lines: DiffLine[];
}

export interface ScaffoldFile {
  path: string;
  contents: string;
}

export interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface PullRequestDraft {
  title: string;
  body: string;
  branch: string;
  base: string;
  files: DiffFile[];
  tests: TestResult[];
  status: "draft";
}

export interface DocRecord {
  id: string;
  title: string;
  body: string;
  at: string;
}

export type ConfirmAction =
  | "diff_fetch"
  | "pr_draft"
  | "write_doc"
  | "create_issues"
  | "scaffold_code"
  | "run_tests";

export interface Participant {
  id: string;
  name: string;
  label: string;
  micOn: boolean;
  present: boolean;
}

export interface MeetingSummary {
  title: string;
  minutes: string;
  at: string;
}

export type WorkKind = "plan" | "design" | "verify" | "research" | "code" | "evidence" | "selection" | "review" | "conclusion";

export type WorkStatus = "working" | "ready" | "waiting" | "cancelled";

export interface Workstream {
  id: string;
  kind: WorkKind;
  title: string;
  status: WorkStatus;
  summary: string;
  artifactPath?: string;
  progress?: string;
  jobId?: string;
  speaker?: string;
  evidence?: EvidenceReport;
  selection?: TechSelection;
  debate?: Debate;
  updatedAt: string;
}

export interface Suggestion {
  id: string;
  text: string;
  at: string;
}

export interface PendingConfirm {
  id: string;
  prompt: string;
  action: ConfirmAction;
  payload?: Record<string, unknown>;
}

export interface ToolTraceEntry {
  tool: string;
  ok: boolean;
  summary: string;
  at: string;
}

export interface ProgressReport {
  id: string;
  text: string;
  at: string;
}

export interface MeetingState {
  id: string;
  title: string;
  incidentDate: string;
  scenario: MeetingScenario;
  status: MeetingStatus;
  joinCode: string;
  workspaceId: string;
  threadId: string | null;
  participants: Participant[];
  summary: MeetingSummary | null;
  scheduledFor: string | null;
  workstreams: Workstream[];
  suggestions: Suggestion[];
  seq: number;
  transcript: TranscriptEntry[];
  timeline: TimelineEvent[];
  decisions: Decision[];
  requirements: Requirement[];
  todos: TodoItem[];
  chatter: ChatterItem[];
  deploy: DeployRecord | null;
  incidentDiff: DiffFile[] | null;
  scaffold: ScaffoldFile[] | null;
  pullRequest: PullRequestDraft | null;
  docs: DocRecord[];
  pending: PendingConfirm | null;
  confirmQueue: PendingConfirm[];
  progress: ProgressReport[];
  toolTrace: ToolTraceEntry[];
  substantiveTurns: number;
  updatedAt: string;
}

export interface PlannedTool {
  name: string;
  arguments: Record<string, unknown>;
}

export interface Classification {
  kind: UtteranceKind;
  confidence: number;
  summary: string;
  tools: PlannedTool[];
  reply: string | null;
  silent: boolean;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
}
