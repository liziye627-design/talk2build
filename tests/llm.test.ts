import { afterEach, describe, expect, it, vi } from "vitest";
import { bedrockPlan } from "@/lib/llm/bedrock";
import { resolveProviderId } from "@/lib/llm";
import { createMockProvider } from "@/lib/llm/mock";
import { openAIPlan, openAISettings } from "@/lib/llm/openai";
import { extractJson, parsePlan } from "@/lib/llm/parse-plan";
import { REPLIES } from "@/lib/demo-script";

describe("llm providers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("plans the first beat deterministically in mock mode", async () => {
    const plan = await createMockProvider().plan({
      text: "PagerDuty woke me at 2:17. Order service 500s spiked to 40%.",
      speaker: "A",
      pending: null,
      stateSummary: "empty",
    });
    expect(plan.reply).toBe(REPLIES.event);
    expect(plan.tools.map((tool) => tool.name)).toContain("timeline_add");
  });

  it("parses a fenced model plan and rejects unknown tools", () => {
    const input = { text: "hello", speaker: "A" as const, pending: null };
    const parsed = parsePlan(
      '```json\n{"kind":"chatter","summary":"lunch","reply":null,"silent":true,"tools":[{"name":"chatter_park","arguments":{"speaker":"B","text":"lunch"}}]}\n```',
      input,
    );
    expect(parsed.kind).toBe("chatter");
    expect(parsed.silent).toBe(true);
    expect(() => extractJson("no json here")).toThrow(/JSON/);
    expect(() =>
      parsePlan('{"kind":"event","tools":[{"name":"drop_database","arguments":{}}]}', input),
    ).toThrow(/Unknown tool/);
  });

  it("points Nebius at Token Factory and an NVIDIA model", () => {
    vi.stubEnv("LLM_PROVIDER", "nebius");
    vi.stubEnv("OPENAI_BASE_URL", "");
    vi.stubEnv("OPENAI_MODEL", "");
    expect(resolveProviderId()).toBe("openai");
    const settings = openAISettings();
    expect(settings.baseURL).toBe("https://api.tokenfactory.nebius.com/v1");
    expect(settings.model).toBe("nvidia/Nemotron-3_5-Lightning");
  });

  it("reads an OpenAI-compatible completion", async () => {
    const plan = await openAIPlan(
      { text: "hi", speaker: "A", pending: null, stateSummary: "" },
      { baseURL: "https://api.tokenfactory.nebius.com/v1", apiKey: "test", model: "nvidia/Nemotron-3_5-Lightning" },
      async (url, init) => {
        expect(String(url)).toBe("https://api.tokenfactory.nebius.com/v1/chat/completions");
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe("nvidia/Nemotron-3_5-Lightning");
        expect(init?.headers).toMatchObject({ authorization: "Bearer test" });
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    kind: "event",
                    summary: "spike",
                    reply: REPLIES.event,
                    silent: false,
                    tools: [{ name: "timeline_add", arguments: { speaker: "A", timeLabel: "02:17", title: "orders API 500 40%" } }],
                  }),
                },
              },
            ],
          }),
        );
      },
    );
    expect(plan.reply).toBe(REPLIES.event);
  });

  it("reads a Bedrock Converse payload", async () => {
    const plan = await bedrockPlan(
      { text: "lunch", speaker: "B", pending: null, stateSummary: "" },
      {
        async send(command) {
          expect(command.input?.modelId).toBeTruthy();
          return {
            output: {
              message: {
                content: [
                  {
                    text: JSON.stringify({
                      kind: "chatter",
                      summary: "lunch",
                      reply: null,
                      silent: true,
                      tools: [{ name: "chatter_park", arguments: { speaker: "B", text: "lunch" } }],
                    }),
                  },
                ],
              },
            },
          };
        },
      },
    );
    expect(plan.kind).toBe("chatter");
    expect(plan.reply).toBeNull();
  });
});
