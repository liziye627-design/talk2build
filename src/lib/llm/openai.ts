import { parsePlan, plannerPrompt } from "@/lib/llm/parse-plan";
import type { ClassifyInput } from "@/lib/classifier";
import type { ChatMessage } from "@/lib/llm/types";
import type { Classification } from "@/lib/types";

export interface OpenAISettings {
  baseURL: string;
  apiKey: string;
  model: string;
}

export function openAISettings(): OpenAISettings {
  const selected = (process.env.LLM_PROVIDER || "").toLowerCase();
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
  if (!settings.apiKey) {
    throw new Error("OPENAI_API_KEY or NEBIUS_API_KEY is not set.");
  }
  const response = await fetchImpl(`${settings.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${settings.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0,
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
