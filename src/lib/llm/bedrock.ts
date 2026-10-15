import { parsePlan, plannerPrompt } from "@/lib/llm/parse-plan";
import type { ClassifyInput } from "@/lib/classifier";
import type { ChatMessage } from "@/lib/llm/types";
import type { Classification } from "@/lib/types";

export interface BedrockSender {
  send(command: { input?: { modelId?: string } }): Promise<{
    output?: { message?: { content?: Array<{ text?: string }> } };
  }>;
}

export async function completeWithBedrock(prompt: ChatMessage, sender?: BedrockSender): Promise<string> {
  const modelId = process.env.BEDROCK_MODEL_ID || "amazon.nova-lite-v1:0";
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  let client = sender;
  if (!client) {
    const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
    const runtime = new BedrockRuntimeClient({ region });
    client = {
      async send() {
        const response = await runtime.send(
          new ConverseCommand({
            modelId,
            system: [{ text: prompt.system }],
            messages: [{ role: "user", content: [{ text: prompt.user }] }],
            inferenceConfig: { maxTokens: 1200, temperature: 0 },
          }),
        );
        return {
          output: {
            message: {
              content: (response.output?.message?.content ?? []).map((block) => ({
                text: "text" in block ? block.text : undefined,
              })),
            },
          },
        };
      },
    };
  }
  const response = await client.send({ input: { modelId } });
  const text = (response.output?.message?.content ?? [])
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
  if (!text) throw new Error("Bedrock returned an empty completion.");
  return text;
}

export async function bedrockPlan(
  input: ClassifyInput & { stateSummary: string },
  sender?: BedrockSender,
): Promise<Classification> {
  const raw = await completeWithBedrock(plannerPrompt(input), sender);
  return parsePlan(raw, input);
}
