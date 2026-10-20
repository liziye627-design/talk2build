import type { ClassifyInput } from "@/lib/classifier";
import type { Classification } from "@/lib/types";

export interface LlmProvider {
  id: "mock" | "bedrock" | "openai" | "local";
  model: string | null;
  plan(input: ClassifyInput & { stateSummary: string }): Promise<Classification>;
}

export interface ChatMessage {
  system: string;
  user: string;
}
