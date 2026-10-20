import { describe, expect, it } from "vitest";
import { parseExtraction } from "@/lib/agent/fixtures";

describe("parseExtraction tolerates small local models", () => {
  it("accepts a { speaker: text } map for decisions and drops chatter when there is work", () => {
    const raw = JSON.stringify({ decisions: { Chris: "Use a static page" }, actionItems: [], jobs: [], chatter: "Let's decide to use a static page" });
    const out = parseExtraction(raw, "m", "Chris", "Let's decide to use a static page");
    expect(out.decisions).toEqual([{ text: "Use a static page", speaker: "Chris" }]);
    expect(out.chatter).toBeNull();
  });
  it("accepts bare strings and keeps real chatter", () => {
    expect(parseExtraction(JSON.stringify({ actionItems: ["Write copy"] }), "m", "Priya", "x").actionItems).toEqual([{ text: "Write copy", speaker: "Priya" }]);
    expect(parseExtraction(JSON.stringify({ decisions: [], chatter: "football" }), "m", "Chris", "x").chatter).toBe("football");
  });
});
