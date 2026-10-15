import { classifyUtterance, type ClassifyInput } from "@/lib/classifier";
import type { Classification } from "@/lib/types";
import type { LlmProvider } from "@/lib/llm/types";

export function mockPlan(input: ClassifyInput): Classification {
  return classifyUtterance(input);
}

export function createMockProvider(): LlmProvider {
  return {
    id: "mock",
    model: null,
    async plan(input) {
      return mockPlan(input);
    },
  };
}
