# Devpost description draft

**Name:** Talk2Build

**Track:** Alexa+

**Mini challenges:** AWS Builder (Amazon Bedrock), Open Source (this repository, MIT)

## What it does

Talk2Build is the meeting where the work gets done. Alexa+ sits in a working session, and by the time the room stands up there is a timeline, a decision, a doc, and a draft pull request.

The demo is a postmortem. Last night at 2:17 AM the orders service started returning 500s. This morning two engineers talk it through. Talk2Build is listening.

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

The plan is a list of MCP tool calls: ingest, classify, timeline, correlate, deploy lookup, diff, decision, confirm, todos, doc, scaffold, pull request, tests, progress. The server holds the 2:17 AM fixtures: the 11:40 PM deploy of batch-reconcile v2.3, Redis connections climbing at 2:15, and a diff that shrinks `max_connections` from 50 to 20 and drops the command timeout. The fix PR touches three files. The test runner checks those files and comes back green.

The web app is three columns: the live transcript, the timeline plus the decision and requirement pool (chatter sits underneath, visually out of that pool), and the diff / pull request.

## What to submit alongside this text

- This repository, public, with the MIT license.
- A public English demo video at or under three minutes. The shot list is in `docs/shot-list.md`.
- Product feedback for every Amazon and AWS surface we used. Draft in `docs/product-feedback.md`.
- Optional friction log, `docs/friction-log.md`, for the judging bonus.

Built during the hackathon window. Nothing here existed before.
