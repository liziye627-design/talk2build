# Devpost description draft

**Name:** Talk2Build

**Track:** Alexa+

**Mini challenges:** AWS Builder (Amazon Bedrock), Open Source (this repository, MIT)

## What it does

Talk2Build is a meeting product. The home screen is start, join, and schedule. In the room, several people talk on an avatar grid with live captions. A right-hand agent works without being prompted: it updates the plan, drafts architecture, wireframes, and API specs when design comes up, checks feasibility against earlier decisions, and collects references from past meetings. Each workstream is a live card. Scaffolding and tests wait for a spoken yes. Chatter stays parked. The task desk is secondary. The 2:17 AM orders postmortem is one scripted mode.

- Real work and chatter are not the same thing. “记一下” and “就这么定了” act immediately. Lunch talk is parked in a chatter column and never enters the requirement pool. Alexa+ stays quiet.
- Every requirement remembers who said it. The demo labels speakers A and B. Voiceprints can come later.
- Small things happen. The postmortem is written as soon as the root cause is named. Large things wait. Alexa+ asks before it pulls the diff and again before it opens the pull request.
- “stop” or “不对” halts the room, rolls back to the last checkpoint, and asks what you want instead.
- A progress line lands every few beats: what changed, whether the fix is scaffolded, whether the tests are green.

## How it works

The voice front-end is Alexa+. In the browser that is a simulated Alexa+ client (`src/alexa/client.ts`) speaking MCP over Streamable HTTP, protocol `2025-11-25`. On a device, the same server is the endpoint in `alexa/addon-package/addon.json`.

Each utterance is planned by a pluggable model layer:

- **Mock**, the default. Deterministic, no keys, which is how the demo runs offline.
- **Amazon Bedrock** Converse, for the AWS Builder mini challenge.
- **An OpenAI-compatible endpoint**, defaulting to Nebius Token Factory and `nvidia/Nemotron-3_5-Lightning`, so the same project can be shown on the Nebius x NVIDIA track.

The plan is a list of MCP tool calls. Meetings, tasks, and artifacts persist in SQLite. Incident meetings still use the 2:17 AM fixtures: batch-reconcile v2.3 at 11:40 PM, Redis climbing at 2:15, and a diff that shrinks `max_connections` from 50 to 20 and drops the command timeout. Any other meeting writes real markdown, scaffolds files into a workspace, and runs `node --test`. Large actions wait for a yes.

Home is the meeting list: start, join, schedule, and recent rooms. Inside a room, an avatar grid and captions sit beside an agent panel. While people talk, MCP tools update that panel: `plan_update`, `design_draft`, `verify_check`, and `research_collect`. Suggestions come from earlier decisions and saved preferences. The task desk at `/tasks` is the secondary thread view. Ending the meeting writes minutes, including the agent cards, back to the task.

## What to submit alongside this text

- This repository, public, with the MIT license.
- A public English demo video at or under three minutes. The shot list is in `docs/shot-list.md`.
- Product feedback for every Amazon and AWS surface we used. Draft in `docs/product-feedback.md`.
- Optional friction log, `docs/friction-log.md`, for the judging bonus.

Built during the hackathon window. Nothing here existed before.
