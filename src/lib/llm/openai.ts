import { parsePlan, plannerPrompt } from "@/lib/llm/parse-plan";
import type { ClassifyInput } from "@/lib/classifier";
import type { ChatMessage } from "@/lib/llm/types";
import type { Classification } from "@/lib/types";

export interface OpenAISettings {
  baseURL: string;
  apiKey: string;
  model: string;
  /** Local OpenAI-compatible server (Ollama, llama.cpp). No API key needed; asks for JSON output. */
  local?: boolean;
  /** Ask the server for a JSON object (response_format). Used for plans and extraction, not prose drafts. */
  jsonMode?: boolean;
}

export const LOCAL_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
export const LOCAL_DEFAULT_MODEL = "qwen2.5:1.5b";

export function localSettings(): OpenAISettings {
  return {
    baseURL: (process.env.LOCAL_LLM_BASE_URL || LOCAL_DEFAULT_BASE_URL).replace(/\/$/, ""),
    apiKey: process.env.LOCAL_LLM_API_KEY || "",
    model: process.env.LOCAL_LLM_MODEL || LOCAL_DEFAULT_MODEL,
    local: true,
    jsonMode: true,
  };
}

export function openAISettings(): OpenAISettings {
  const selected = (process.env.LLM_PROVIDER || "").toLowerCase();
  if (selected === "local" || selected === "ollama") return localSettings();
  const nebius = selected === "nebius";
  const baseURL = (
    process.env.OPENAI_BASE_URL ||
    (nebius ? "https://api.tokenfactory.nebius.com/v1" : "https://api.openai.com/v1")
  ).replace(/\/$/, "");
  const apiKey = process.env.OPENAI_API_KEY || process.env.NEBIUS_API_KEY || "";
  const model =
    process.env.OPENAI_MODEL || (nebius ? "nvidia/Nemotron-3_5-Lightning" : "gpt-4o-mini");
  return { baseURL, apiKey, model };
}

export async function completeWithOpenAI(
  prompt: ChatMessage,
  settings: OpenAISettings = openAISettings(),
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!settings.apiKey && !settings.local) {
    throw new Error("OPENAI_API_KEY or NEBIUS_API_KEY is not set.");
  }
  const response = await fetchImpl(`${settings.baseURL}/chat/completions`, {
    method: "POST",
    // Local servers can run away on a small model; cap time and length so a turn never hangs.
    ...(settings.local ? { signal: AbortSignal.timeout(Number(process.env.LOCAL_LLM_TIMEOUT_MS) || 45000) } : {}),
    headers: {
      ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0,
      ...(settings.local ? { max_tokens: Number(process.env.LOCAL_LLM_MAX_TOKENS) || 512 } : {}),
      ...(settings.jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI-compatible request failed (${response.status}).`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenAI-compatible response had no content.");
  return text;
}

export async function openAIPlan(
  input: ClassifyInput & { stateSummary: string },
  settings?: OpenAISettings,
  fetchImpl?: typeof fetch,
): Promise<Classification> {
  const raw = await completeWithOpenAI(plannerPrompt(input), settings, fetchImpl);
  return parsePlan(raw, input);
}
