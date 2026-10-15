# Shot list

Target: at or under 3:00, English, public on YouTube or Vimeo. No third-party music. Lead with the incident, not the architecture.

Record the web app with **Play demo**. Mock mode is the right take: it is deterministic and it matches these lines. If a browser voice is available, leave TTS on. Cut the title card to about three seconds.

| Time | Picture | Spoken or on-screen line |
| --- | --- | --- |
| 0:00–0:08 | Title card on the dark room. Wordmark visible. | “Last night, 2:17 AM. The orders service went down. This morning, two engineers hold a post-mortem. Talk2Build is listening.” |
| 0:08–0:22 | Left column. Speaker A’s line types in. Timeline gains 02:17. Alexa+ caption. | A: “PagerDuty woke me at 2:17. Order service 500s spiked to 40%.” Alexa+: “Logged. 2:17 AM, orders API, 40% errors.” |
| 0:22–0:38 | Middle column. 02:15 appears above 02:17 with the link and the Redis sparkline. | B: “I checked Grafana. Redis connections started climbing at 2:15 — two minutes before the errors.” Alexa+: “Correlated: Redis pressure started two minutes before the errors.” |
| 0:38–0:52 | Right column. Deploy card: batch-reconcile v2.3, 11:40 PM. | A: “Wasn’t there a batch job deployed last night? The reconciliation one?” Alexa+: “Found it — batch-reconcile v2.3 deployed at 11:40 PM. Want me to pull the diff?” |
| 0:52–1:08 | Diff. `max_connections` 50 → 20 and the deleted `command_timeout_ms` highlighted. | B: “Yes, pull it.” Alexa+: “The diff shows the pool was shrunk from 50 to 20 connections, and no timeout was set.” |
| 1:08–1:26 | Decision and the three requirements in the pool. Doc title appears. Alexa+ waits. | A: “That’s the root cause. The job drained the Redis pool.” Alexa+: “Root cause logged. I’m drafting the fix PR — pool rollback, timeouts, and a pool-exhaustion alert. Say the word and I’ll open it.” |
| 1:26–1:36 | Chatter column. Nothing new in the requirement pool. No Alexa+ line. | B: “Did anyone order lunch yet? I’m starving.” Hold on the silence. |
| 1:36–1:50 | Two todos. A progress line in the footer. | A: “Action items: add the pool alert, and put the job behind a feature flag.” Alexa+: “Two action items captured.” Then the progress line. |
| 1:50–2:15 | PR tab. Three files type in. Four green tests. | B: “Okay, open the PR.” Alexa+: “PR draft ready. Three files changed, tests passing.” |
| 2:15–2:28 | Optional insert, only if you have the seconds. Hit **Stop / 不对** after a stray line and show the rollback question. | Alexa+: “Rolled back to the last checkpoint. What do you want instead?” |
| 2:28–2:45 | End card. | “The meeting ended. So did the bug.” Then: “Talk2Build — the meeting where the work gets done.” |
| 2:45–3:00 | If you still have room: the footer trace (`ingest_transcript`, `timeline_correlate`, `pr_draft`, `run_tests`) and the MCP 2025-11-25 badge. One sentence on Alexa+ calling the server. | “Alexa+ is the voice. The MCP server does the work.” |

Do not show a terminal, a README, or a settings page. Judges are not required to watch past three minutes.

## What “good” looks like in frame

- Speaker chips A and B, and Alexa+ as its own voice.
- 02:15 linked to 02:17.
- The deploy card reading v2.3 and 11:40 PM.
- The red diff lines for 50 → 20 and the missing timeout.
- Lunch in chatter, not in the requirement list.
- Three files and four passing tests.
- One progress line, spoken or on screen.

## Capture notes

- Window at 1440×900 or larger so all three columns are on screen. The layout stacks behind tabs below that width; the video should be the desktop layout.
- Run `npm run dev` and use Play demo rather than typing the beats live, unless you want the microphone as a second five-second insert.
- Mock mode badge should be visible, or switch the corner chip to Bedrock only if you have actually configured a key and checked a turn.
