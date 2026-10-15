# Devpost description draft

**Name:** Talk2Build

**Track:** Alexa+

**Mini challenges:** AWS Builder (Amazon Bedrock), Open Source (this repository, MIT)

## What it does

Talk2Build is the desk where the work gets done. You describe an outcome. The agent shows the plan, runs MCP tools, and leaves real files in a workspace. A meeting is one of those tasks: Alexa+ listens, and when the room ends the minutes show up on the same thread.

The 2:17 AM orders postmortem is one scripted mode, not the whole product. Open it from Incident demo. The home page is a task: yesterday's decision, issues from the action items, a spec, a scaffold with tests, or a live room.

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

The desk is a task thread with a plan, tool cards, and an artifact monitor. The meeting room is a separate screen: participant tiles, mic, captions, and the live pool. Ending the meeting writes minutes back to the task.

## What to submit alongside this text

- This repository, public, with the MIT license.
- A public English demo video at or under three minutes. The shot list is in `docs/shot-list.md`.
- Product feedback for every Amazon and AWS surface we used. Draft in `docs/product-feedback.md`.
- Optional friction log, `docs/friction-log.md`, for the judging bonus.

Built during the hackathon window. Nothing here existed before.
