import { describe, expect, it } from "vitest";
import { UI_LANG, UI_TEXT, ui } from "@/lib/ui-text";
import { isInterrupt } from "@/lib/classifier";
import { parseMentions } from "@/lib/seats/roster";

function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    typeof child === "function" ? [`${prefix}${key}()`] : keys(child, `${prefix}${key}.`),
  );
}

describe("ui text dictionary", () => {
  it("defaults to English", () => {
    expect(UI_LANG).toBe("en");
    expect(ui.assistantName).toBe("Alexa+");
    expect(ui.stage.tabWork).toBe("Work");
  });
  it("keeps the Chinese copy with the same shape", () => {
    expect(UI_TEXT.zh.assistantName).toBe("Alexa+ 助手");
    expect(keys(UI_TEXT.zh).filter((key) => !key.startsWith("tree.title"))).toEqual(keys(UI_TEXT.en).filter((key) => !key.startsWith("tree.title")));
  });
  it("still understands Chinese input in the English UI", () => {
    expect(isInterrupt("不对")).toBe(true);
    expect(parseMentions("@架构师 @AI Skeptic 辩一下 方案A").seats).toEqual(["architect", "skeptic"]);
  });
});
