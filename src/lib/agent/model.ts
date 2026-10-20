import { keywordExtraction, parseExtraction } from "@/lib/agent/fixtures";
import type { ExtractInput, Extraction } from "@/lib/agent/types";
import { completeWithBedrock } from "@/lib/llm/bedrock";
import { completeWithOpenAI, localSettings, openAISettings } from "@/lib/llm/openai";
import type { ChatMessage } from "@/lib/llm/types";

export type AgentBackend = "bedrock" | "openai" | "local" | "fixture";

function envValue(name: string) {
  return process.env[name]?.trim() || "";
}

export function bedrockCredentialState(): "ready" | "partial" | "absent" {
  const id = envValue("AWS_ACCESS_KEY_ID");
  const secret = envValue("AWS_SECRET_ACCESS_KEY");
  if (envValue("AWS_BEARER_TOKEN_BEDROCK") || (id && secret)) return "ready";
  if (id || secret) return "partial";
  return "absent";
}

export function skipBedrockMessage() {
  const id = envValue("AWS_ACCESS_KEY_ID");
  const secret = envValue("AWS_SECRET_ACCESS_KEY");
  if (id && !secret) {
    return "Skipping Bedrock: AWS_ACCESS_KEY_ID is set without AWS_SECRET_ACCESS_KEY. Set both, or set AWS_BEARER_TOKEN_BEDROCK.";
  }
  if (secret && !id) {
    return "Skipping Bedrock: AWS_SECRET_ACCESS_KEY is set without AWS_ACCESS_KEY_ID. Set both, or set AWS_BEARER_TOKEN_BEDROCK.";
  }
  return "Skipping Bedrock: set both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or set AWS_BEARER_TOKEN_BEDROCK.";
}

export function resolveAgentBackend(): AgentBackend {
  const forced = (process.env.TALK2BUILD_AGENT || process.env.LLM_PROVIDER || "").toLowerCase();
  if (forced === "mock" || forced === "fixture") return "fixture";
  if (forced === "openai" || forced === "nebius") return "openai";
  if (forced === "local" || forced === "ollama") return "local";
  const credentials = bedrockCredentialState();
  if (credentials === "ready" && (forced === "bedrock" || !forced)) return "bedrock";
  if (forced === "bedrock" || credentials === "partial") console.warn(skipBedrockMessage());
  if (envValue("NEBIUS_API_KEY") || envValue("OPENAI_API_KEY")) return "openai";
  return "fixture";
}

export function agentModelLabel() {
  const backend = resolveAgentBackend();
  if (backend === "bedrock") return process.env.BEDROCK_MODEL_ID || "amazon.nova-lite-v1:0";
  if (backend === "openai") return openAISettings().model;
  if (backend === "local") return localSettings().model;
  return "recorded-fixtures";
}

const EXTRACT_SYSTEM = [
  "You extract work from one meeting utterance.",
  "Return one JSON object with keys intents, decisions, actionItems, jobs, chatter, suggestion.",
  "jobs is an array of { kind, title, brief, speaker, needsConfirm }.",
  "kind is plan, design, verify, research, or code.",
  "Attribute every decision, action item, and job to the speaker who said it.",
  "code always needs confirmation. Never start code, tests, or a pull request yourself.",
  "Park side chatter: chatter is the text, jobs is empty.",
  "suggestion is a short reminder only when the context already contains a matching decision. Otherwise null.",
  "Do not invent URLs. Do not invent decisions that are not in the utterance or the context.",
  "Exact shapes: intents, decisions and actionItems are arrays of { text, speaker }. chatter is a string or null.",
  "Set chatter only for off-topic small talk; when there is a decision, action item or job, chatter must be null.",
  "A commitment like 'I will X by Friday' is an actionItem. 'Let's decide/go with X' is a decision.",
  'Example for Speaker: Ana, Utterance: "Let\'s go with Postgres, and I will set it up by Monday." ->',
  '{"intents":[],"decisions":[{"text":"Use Postgres","speaker":"Ana"}],"actionItems":[{"text":"Set up Postgres by Monday","speaker":"Ana"}],"jobs":[],"chatter":null,"suggestion":null}',
].join(" ");

export function extractionPrompt(input: ExtractInput): ChatMessage {
  return {
    system: EXTRACT_SYSTEM,
    user: [`Speaker: ${input.speaker}`, `Utterance: ${input.text}`, "", "Context:", input.context || "No earlier notes."].join("\n"),
  };
}

export async function extractMeetingTurn(input: ExtractInput, fetchImpl?: typeof fetch): Promise<Extraction> {
  const backend = resolveAgentBackend();
  if (backend === "fixture") return keywordExtraction(input.meetingId, input.speaker, input.text);
  try {
    const raw =
      backend === "bedrock"
        ? await completeWithBedrock(extractionPrompt(input))
        : await completeWithOpenAI(extractionPrompt(input), backend === "local" ? localSettings() : openAISettings(), fetchImpl);
    return parseExtraction(raw, input.meetingId, input.speaker, input.text);
  } catch {
    return keywordExtraction(input.meetingId, input.speaker, input.text);
  }
}

export const MODEL_FALLBACK_NOTICE = "The model request failed. This card uses the meeting template.";

export async function draftWithModel(
  system: string,
  user: string,
  fetchImpl?: typeof fetch,
): Promise<{ text: string | null; notice: string | null }> {
  const backend = resolveAgentBackend();
  if (backend === "fixture") return { text: null, notice: null };
  try {
    const prompt = { system, user };
    const text =
      backend === "bedrock"
        ? await completeWithBedrock(prompt)
        : await completeWithOpenAI(prompt, backend === "local" ? { ...localSettings(), jsonMode: false } : openAISettings(), fetchImpl);
    return { text, notice: null };
  } catch {
    return { text: null, notice: MODEL_FALLBACK_NOTICE };
  }
}
