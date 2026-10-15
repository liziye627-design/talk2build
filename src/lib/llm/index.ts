import { bedrockPlan } from "@/lib/llm/bedrock";
import { createMockProvider } from "@/lib/llm/mock";
import { openAIPlan, openAISettings } from "@/lib/llm/openai";
import type { LlmProvider } from "@/lib/llm/types";

export type ProviderId = "mock" | "bedrock" | "openai";

export function resolveProviderId(): ProviderId {
  const raw = (process.env.LLM_PROVIDER || "mock").toLowerCase();
  if (raw === "bedrock") return "bedrock";
  if (raw === "openai" || raw === "nebius") return "openai";
  return "mock";
}

export function normalizeProvider(raw: string | undefined): ProviderId {
  const value = (raw || "mock").toLowerCase();
  if (value === "bedrock") return "bedrock";
  if (value === "openai" || value === "nebius") return "openai";
  return "mock";
}

export function createProvider(override?: string): LlmProvider {
  const id = override ? normalizeProvider(override) : resolveProviderId();
  if (id === "bedrock") {
    return {
      id: "bedrock",
      model: process.env.BEDROCK_MODEL_ID || "amazon.nova-lite-v1:0",
      plan: (input) => bedrockPlan(input),
    };
  }
  if (id === "openai") {
    const settings = openAISettings();
    return {
      id: "openai",
      model: settings.model,
      plan: (input) => openAIPlan(input, settings),
    };
  }
  return createMockProvider();
}

export function providerPublicConfig() {
  const id = resolveProviderId();
  if (id === "bedrock") {
    return {
      provider: id,
      model: process.env.BEDROCK_MODEL_ID || "amazon.nova-lite-v1:0",
    };
  }
  if (id === "openai") {
    const settings = openAISettings();
    return { provider: (process.env.LLM_PROVIDER || "openai").toLowerCase(), model: settings.model };
  }
  return { provider: "mock", model: null };
}
