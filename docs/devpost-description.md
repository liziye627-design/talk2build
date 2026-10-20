# Devpost submission: Talk2Build

Copy each section into the matching field of the Devpost form. Everything below describes what is in the public repository at `main` and what the demo video shows.

## Project name

Talk2Build

## Tagline

A meeting agent for Alexa+: the team talks, and it turns their decisions into plans, designs, a spec and a tested prototype. Nothing that writes code runs until a human says yes.

## Try it out

- Code: https://github.com/liziye627-design/talk2build (public, MIT)
- Demo video (2:26): https://youtu.be/oLMys1SccUk
- Run locally: Node.js 22+, then `npm install`, `npm test`, `npm run build`, `npm start`, and open http://127.0.0.1:43123. Mock mode needs no API keys. See the README for the production environment variables.

## Inspiration

Most meetings end with a to-do list that someone has to turn into work by hand. We wanted the opposite: an assistant that sits in the call, listens for real decisions, ignores the small talk, and starts the work while people are still talking. It shouldn't make anyone type a command, and it shouldn't do anything risky without asking. Voice-first Alexa+ plus MCP tools felt like the right shape for that.

## What it does

Talk2Build is a meeting room with an agent panel. The demo case is a pizza-deadline game jam: Maya, Chris and Priya want a tiny browser game, Space Cat Courier, before the pizza arrives.

- **Says the goal, gets a plan.** Maya states the goal out loud. A Plan card appears, and the decision and action items are saved under her name. Every requirement remembers who said it.
- **Designs land while people talk.** When Chris describes the architecture and Priya asks for a wireframe, Talk2Build writes SVG artifacts. They render inline in the cards and appear on a shared stage in the meeting.
- **Live evidence, human decision.** "Phaser or PixiJS, which is more popular?" produces an evidence card with live GitHub stars, open issues, last push and npm weekly downloads, each with its source URL. Talk2Build recommends; the humans decide on plain canvas with zero dependencies, and that decision is recorded.
- **Chatter gets parked.** "Is the pizza here yet?" goes into a parked list and never enters the plan.
- **Feasibility check.** "Check that it's feasible on a phone" produces a feasibility card.
- **A human-yes gate.** Anything that writes code waits for a spoken "Yes". After Maya says yes, Talk2Build writes `docs/spec.md` from the meeting's decisions, scaffolds the prototype from its game-jam template, and runs the real `node --test` suite (7 of 7 pass). Progress shows on the card.
- **Playable in the meeting.** The prototype runs in a sandboxed iframe on the shared stage (strict CSP, scripts only). In the video it is played: dodge asteroids, grab pizza for fuel, and every ten parcels the asteroids speed up.
- **Minutes and files stay.** Ending the meeting writes minutes. The spec, designs, prototype and test file stay in the meeting's workspace.

The UI is English by default, through a small zh/en dictionary (`NEXT_PUBLIC_UI_LANG=zh` switches to Chinese). The voice input still understands Chinese trigger phrases.

**Honest scope.** The demo runs in mock mode (`LLM_PROVIDER=mock`, `TALK2BUILD_AGENT=mock`). The meeting lines are scripted, and agent output comes from deterministic fixtures, so no model is called. The Space Cat Courier game comes from a template written ahead of time: the meeting selects it and fills the spec, but it is not generated live. The video, the spec and the in-game footer all say so. The evidence numbers and the test run are real. The gameplay in the video is driven by a scripted keyboard bot.

## How we built it

- **Alexa+ path:** a self-hosted MCP server, protocol `2025-11-25`, over Streamable HTTP at `/mcp` (POST/GET/DELETE, `MCP-Session-Id`, JSON or SSE responses). The browser uses a simulated Alexa+ client (`src/alexa/client.ts`) that initializes a session and calls the same tools over HTTP, which is the simulated-experience path the rules allow. `alexa/addon-package/addon.json` is the add-on manifest for a real Alexa+ client. We did not deploy it, because the add-on tools are partner preview only.
- **Tools:** plan, design drafts (SVG), feasibility checks, research and evidence (live GitHub and npm APIs, cached for 10 minutes), `scaffold_code` and `run_tests` (spawns `node --test`), behind a confirmation gate.
- **Planner:** a pluggable model layer, with three providers:
  - deterministic mock (the default, used in the demo);
  - Amazon Bedrock Converse through `@aws-sdk/client-bedrock-runtime` (`LLM_PROVIDER=bedrock`, default model `amazon.nova-lite-v1:0`);
  - an OpenAI-compatible endpoint.
  If a provider fails, the turn falls back to the mock and the client is told.
- **App:** Next.js 15 / React 19 / TypeScript / Tailwind, with storage in SQLite via `node:sqlite`. Produced files are served raw with a sandbox CSP, `nosniff` and `no-store`.
- **Quality:** Vitest suite with 164 passing tests (2 skipped), including an HTTP end-to-end run of the game-jam meeting. tsc and eslint are clean.
- **Video:** recorded from the production build with Playwright, narrated with Kokoro TTS. Captions and loudness normalisation (-16 LUFS) are done in ffmpeg, and the narration was checked by transcribing it back with Whisper. The scripts are in `demo/v2-pipeline/`.

## Challenges we ran into

- Telling real work from chatter without making people speak in commands. A phrase like "we're going with…" first triggered a write confirmation that blocked the later "Yes".
- Keeping the demo honest. An early script line claimed Phaser had more GitHub stars. The live card showed PixiJS ahead, so we rewrote the line.
- Making a generated page playable inside the meeting without trusting it: a sandboxed iframe plus a strict CSP on the raw file route.
- Alexa+ device deployment and AWS credits were unavailable to us (partner-only add-on tools; credit codes gone as of October 7), so the Alexa+ device path and live Bedrock calls could not be exercised.

## Accomplishments that we're proud of

- A meeting that goes from a spoken goal to a spec, two designs, a live evidence card and a tested, playable prototype in about two minutes, with a human-yes gate in front of anything that writes code.
- Evidence that cites its sources and changes with reality instead of a canned chart.
- A full English UI without losing the Chinese path, covered by tests.

## What we learned

- MCP over Streamable HTTP is a clean seam: a meeting agent maps naturally onto tools, and one endpoint serves both the simulator and a real Alexa+ client.
- Confirmation is a product feature: people trust the agent more when the risky step visibly waits for them.
- Honesty labels such as "demo mode" and "scaffolded from a template" make a demo more convincing, not less.

## What's next

- Run the Bedrock planner live (Nova Lite) instead of the mock, and measure latency against the Alexa+ budget.
- Deploy the add-on to a real Alexa+ client once the tools are available.
- Speaker identification instead of scripted speakers, and generating prototypes beyond the game-jam template.

## Built with

typescript, next.js, react, tailwind-css, node.js, sqlite, model-context-protocol, alexa-plus, amazon-bedrock, aws-sdk, vitest, playwright, svg, html5-canvas, github-api, npm-registry-api, ffmpeg, kokoro-tts

## Track and mini challenges

- **Primary track:** Alexa+ (self-hosted MCP server, spec 2025-11-25, Streamable HTTP, demoed through a simulated Alexa+ client in the web app).
- **AWS Builder (mini challenge):** optional. A Bedrock Converse adapter is in the code (`src/lib/llm/bedrock.ts`), wired through `LLM_PROVIDER=bedrock` and documented in the README and in the product feedback. It is unit-tested with an injected client but has never made a live call, and the video runs in mock mode. Select this only if you accept that disclosure.
- **Open Source (mini challenge):**
  - contribution URL and repository URL: https://github.com/liziye627-design/talk2build
  - GitHub username: liziye627-design
  - What we did: built a new MIT-licensed project during the hackathon window (repository created 2026-10-15).
  - How it works: see "How we built it".
  - Why it matters: shipping the MCP server as the product, rather than as a private sidecar, makes the Alexa+ path reviewable and reusable.

## Product feedback (summary; full text in docs/product-feedback.md)

- **Alexa+ MCP / Streamable HTTP:**
  - The transport spec is precise enough to implement without an SDK, and `content` plus `structuredContent` gives both a spoken line and a UI payload.
  - Needs work: the device path is gated behind a public HTTPS URL and the partner-preview CLI; the 500 ms budget should separate tool latency from model latency; and the auth checklist (401 without `WWW-Authenticate`, PKCE S256) surprises generic clients.
  - Would build again: yes.
- **Add-on manifest / Alexa AI CLI:**
  - The schema table is complete.
  - We could not deploy: the CLI needs an authenticated account, and media must be on HTTPS before validation. A published hello-world manifest would help.
  - Would build again: yes, after one successful deploy.
- **Amazon Bedrock (Converse):**
  - A small, clean API; Nova Lite suits short JSON plans.
  - Credit codes were gone and we had no AWS keys, so it was tested only with an injected client. Keep a credit path open through the deadline.
  - Would build again: yes.

An optional friction log is in `docs/friction-log.md`.
