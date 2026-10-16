import { keywordExtraction, parseExtraction } from "@/lib/agent/fixtures";
import type { ExtractInput, Extraction } from "@/lib/agent/types";
import { completeWithBedrock } from "@/lib/llm/bedrock";
import { completeWithOpenAI, openAISettings } from "@/lib/llm/openai";
import type { ChatMessage } from "@/lib/llm/types";

export type AgentBackend = "bedrock" | "openai" | "fixture";

export function resolveAgentBackend(): AgentBackend {
  const forced = (process.env.TALK2BUILD_AGENT || process.env.LLM_PROVIDER || "").toLowerCase();
  if (forced === "mock" || forced === "fixture") return "fixture";
  if (forced === "bedrock") return "bedrock";
  if (forced === "openai" || forced === "nebius") return "openai";
  if (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_BEARER_TOKEN_BEDROCK) {
    return "bedrock";
  }
  if (process.env.NEBIUS_API_KEY || process.env.OPENAI_API_KEY) return "openai";
  return "fixture";
}

export function agentModelLabel() {
  const backend = resolveAgentBackend();
  if (backend === "bedrock") return process.env.BEDROCK_MODEL_ID || "amazon.nova-lite-v1:0";
  if (backend === "openai") return openAISettings().model;
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
        : await completeWithOpenAI(extractionPrompt(input), openAISettings(), fetchImpl);
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
  if (resolveAgentBackend() === "fixture") return { text: null, notice: null };
  try {
    const prompt = { system, user };
    const text =
      resolveAgentBackend() === "bedrock"
        ? await completeWithBedrock(prompt)
        : await completeWithOpenAI(prompt, openAISettings(), fetchImpl);
    return { text, notice: null };
  } catch {
    return { text: null, notice: MODEL_FALLBACK_NOTICE };
  }
}
