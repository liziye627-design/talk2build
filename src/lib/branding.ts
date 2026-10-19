import { ui } from "@/lib/ui-text";
/**
 * Q5: one display name for the meeting assistant. Placeholder until product-analyst decides
 * (architect suggests "Alexa+ 助手" for the Alexa+ track). Change it here only.
 */
export const ASSISTANT_NAME = ui.assistantName;

/** Q2: home-page meeting status labels. */
export const STATUS_LABEL: Record<"scheduled" | "live" | "ended", string> = ui.status;
