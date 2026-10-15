import type { PlannedTool } from "@/lib/types";

export interface Facilitation {
  tools: PlannedTool[];
  reply: string;
}

function mentions(text: string, pattern: RegExp) {
  return pattern.test(text);
}

export function facilitateUtterance(text: string): Facilitation | null {
  const tools: PlannedTool[] = [];
  const notes: string[] = [];

  if (mentions(text, /\b(goal|milestone|plan)\b/i)) {
    tools.push({ name: "plan_update", arguments: { text } });
    notes.push("Plan updated from what you just said.");
  }

  if (mentions(text, /wireframe|mockup|settings screen/i)) {
    tools.push({ name: "design_draft", arguments: { kind: "wireframe", text } });
    notes.push("A settings wireframe is on the design card.");
  } else if (mentions(text, /architect|diagram|worker/i)) {
    tools.push({ name: "design_draft", arguments: { kind: "architecture", text } });
    notes.push("The architecture sketch is on the design card.");
  }

  if (mentions(text, /\bAPI\b|endpoint|POST \//i)) {
    tools.push({ name: "design_draft", arguments: { kind: "api", text } });
    notes.push("The API spec is next to it.");
  }

  if (mentions(text, /run (the )?tests|scaffold/i)) {
    tools.push({
      name: "confirm_ask",
      arguments: {
        action: "scaffold_code",
        prompt: "I'll scaffold the export checker and run its tests. Say yes.",
        payload: { prompt: text },
      },
    });
    notes.push("I'll scaffold the checker and run its tests when you say yes.");
  } else if (mentions(text, /feasib|validate|check that|verify/i)) {
    tools.push({ name: "verify_check", arguments: { text } });
    notes.push("Feasibility is on the verify card.");
  }

  if (mentions(text, /already decided|look up|what did we|reference|metric|research|pull what/i)) {
    tools.push({ name: "research_collect", arguments: { query: text } });
    tools.push({ name: "suggest_surface", arguments: { text } });
    notes.push("I pulled earlier decisions into the research card.");
  } else if (mentions(text, /billing|export|nightly/i)) {
    tools.push({ name: "suggest_surface", arguments: { text } });
  }

  if (mentions(text, /we prefer|we always|remember that we/i)) {
    tools.push({ name: "preference_note", arguments: { text } });
    notes.push("I'll remember that preference for the next meeting.");
  }

  if (tools.length === 0) return null;
  return { tools, reply: notes.join(" ") };
}
