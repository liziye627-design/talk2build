import { GAME_LOGIC, GAME_TESTS } from "@/lib/agent/game-jam/logic";
import { gamePage } from "@/lib/agent/game-jam/page";
import type { MeetingState, ScaffoldFile } from "@/lib/types";

export const GAME_TITLE = "Space Cat Courier";
export const GAME_PAGE_PATH = "game/index.html";
export const TEMPLATE_NOTE = "Prototype scaffolded by Talk2Build from the game-jam template. Spec: docs/spec.md";

/** The game-jam session is recognised by its title phrase anywhere in the meeting. */
export function isGameJamText(text: string) {
  return /space cat courier/i.test(text);
}

export function isGameJamMeeting(state: Pick<MeetingState, "title" | "decisions" | "transcript">) {
  if (isGameJamText(state.title)) return true;
  if (state.decisions.some((item) => isGameJamText(item.text))) return true;
  return state.transcript.some((line) => isGameJamText(line.text));
}

export const GAME_ARTIFACTS: Record<string, { path: string; summary: string }> = {
  "Game architecture": { path: "design/game-architecture.svg", summary: "Architecture: input → game loop → canvas, with a spawner that speeds up every ten parcels." },
  "Game screen wireframe": { path: "design/game-screen.svg", summary: "Wireframe: cat on the left, fuel bar and parcel count up top." },
};

export function gameArchitectureSvg(speaker: string) {
  const box = (x: number, y: number, w: number, title: string, sub: string, stroke = "#006fff") =>
    `<rect x="${x}" y="${y}" width="${w}" height="76" rx="14" fill="#232a3d" stroke="${stroke}" stroke-width="2"/>` +
    `<text x="${x + w / 2}" y="${y + 33}" text-anchor="middle" font-size="17" fill="#ffffff">${title}</text>` +
    `<text x="${x + w / 2}" y="${y + 56}" text-anchor="middle" font-size="12" fill="#aab4cf">${sub}</text>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360" viewBox="0 0 720 360">
  <rect width="720" height="360" rx="18" fill="#141a2b"/>
  <g font-family="Inter, Arial, Helvetica, sans-serif">
    <text x="28" y="40" font-size="13" fill="#7eb6ff">${speaker} · Space Cat Courier · architecture</text>
    ${box(28, 80, 190, "Input", "keys + touch")}
    ${box(265, 80, 190, "Game loop", "step(dt) · fuel · score", "#ffcf5a")}
    ${box(502, 80, 190, "Canvas renderer", "cat · pizza · asteroids")}
    ${box(265, 230, 190, "Spawner", "faster every 10 parcels", "#ff8fab")}
    ${box(502, 230, 190, "HUD", "fuel · parcels · best")}
    <path d="M218 118 H265" stroke="#ffffff" stroke-width="2.5" marker-end="url(#a)"/>
    <path d="M455 118 H502" stroke="#ffffff" stroke-width="2.5" marker-end="url(#a)"/>
    <path d="M360 230 V156" stroke="#ffffff" stroke-width="2.5" marker-end="url(#a)"/>
    <path d="M597 156 V230" stroke="#ffffff" stroke-width="2.5" marker-end="url(#a)"/>
    <defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#ffffff"/></marker></defs>
  </g>
</svg>
`;
}

export function gameScreenSvg(speaker: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="405" viewBox="0 0 720 405">
  <rect width="720" height="405" rx="18" fill="#140a33"/>
  <g font-family="Inter, Arial, Helvetica, sans-serif">
    <rect x="0" y="0" width="720" height="44" rx="18" fill="#000000" fill-opacity="0.35"/>
    <text x="20" y="28" font-size="14" font-weight="bold" fill="#ffffff">SPACE CAT COURIER</text>
    <text x="222" y="28" font-size="12" fill="#c9c3ff">FUEL</text>
    <rect x="262" y="16" width="170" height="16" rx="3" fill="#ffffff" fill-opacity="0.15"/>
    <rect x="262" y="16" width="120" height="16" rx="3" fill="#3ddc97"/>
    <text x="462" y="28" font-size="13" fill="#ffffff">parcels × 0</text>
    <text x="580" y="28" font-size="12" fill="#c9c3ff">best · speed</text>
    <circle cx="120" cy="210" r="34" fill="#f4a259"/>
    <circle cx="120" cy="210" r="44" fill="none" stroke="#a0dcff" stroke-width="2.5" stroke-dasharray="6 5"/>
    <text x="120" y="282" text-anchor="middle" font-size="13" fill="#ffcf5a">the cat (jetpack)</text>
    <path d="M430 150 l-22 -38 q22 -14 44 0 z" fill="#ffcf5a"/>
    <text x="430" y="176" text-anchor="middle" font-size="12" fill="#ffcf5a">pizza parcel +fuel</text>
    <polygon points="560,250 590,236 616,252 612,284 584,298 556,282" fill="#6c5f5b" stroke="#3d3533" stroke-width="3"/>
    <text x="586" y="322" text-anchor="middle" font-size="12" fill="#ff8fab">asteroid = game over</text>
    <path d="M200 210 H330" stroke="#ffffff" stroke-opacity="0.4" stroke-width="2" stroke-dasharray="8 6"/>
    <text x="265" y="200" text-anchor="middle" font-size="11" fill="#aab4cf">↑ ↓ / tap</text>
    <text x="20" y="388" font-size="12" fill="#7eb6ff">${speaker} · wireframe · 16:9</text>
  </g>
</svg>
`;
}

export function gameFeasibility(speaker: string, brief: string) {
  return {
    summary: "Feasible on a phone: plain canvas runs in mobile Safari and Chrome. Add touch controls.",
    body: [
      "# Feasibility: Space Cat Courier on a phone",
      "",
      `Speaker: ${speaker}`,
      "",
      "Template check (demo mode, no model call):",
      "",
      "- Plain 2D canvas, no dependencies, which matches the room's decision.",
      "- One canvas at 960×540, scaled with CSS to the screen.",
      "- Keyboard only would fail on a phone, so the scaffold adds tap-above / tap-below the cat.",
      "",
      "## Heard just now",
      brief,
      "",
    ].join("\n"),
  };
}

/** docs/spec.md, written from what the room actually recorded: decisions, action items, cards. */
export function gameSpec(state: MeetingState) {
  const decisions = state.decisions.map((item) => `- ${item.text} (${item.speaker})`);
  const todos = state.todos.map((item) => `- [ ] ${item.text}${item.speaker ? ` (${item.speaker})` : ""}`);
  const cards = state.workstreams
    .filter((item) => item.status === "ready" && item.kind !== "code")
    .map((item) => `- ${item.title}: ${item.summary}${item.artifactPath ? ` (${item.artifactPath})` : ""}`)
    .reverse();
  return [
    `# ${GAME_TITLE}: spec from the meeting`,
    "",
    `Meeting: ${state.title} · ${state.joinCode}`,
    "",
    "## Decisions",
    ...(decisions.length ? decisions : ["- None recorded."]),
    "",
    "## Action items",
    ...(todos.length ? todos : ["- None recorded."]),
    "",
    "## Cards from the meeting",
    ...(cards.length ? cards : ["- None."]),
    "",
    "## Left out",
    `- ${state.chatter.length} side conversation(s) were parked and are not part of this spec.`,
    "",
    "## Prototype",
    "- `game/index.html` and `game/logic.mjs` come from the Talk2Build game-jam template. The template was written ahead of time; the meeting chose it, it was not generated live.",
    "- Template defaults: fuel drains 6.5/s, each pizza parcel adds 14, asteroids speed up every 10 parcels, keyboard plus touch input.",
    "- `test/game.test.mjs` runs with `node --test`.",
    "",
  ].join("\n");
}

export function gameJamFiles(state: MeetingState): ScaffoldFile[] {
  return [
    { path: "docs/spec.md", contents: gameSpec(state) },
    { path: "game/logic.mjs", contents: GAME_LOGIC },
    { path: GAME_PAGE_PATH, contents: gamePage({ title: GAME_TITLE, footer: TEMPLATE_NOTE }) },
    { path: "test/game.test.mjs", contents: GAME_TESTS },
  ];
}
