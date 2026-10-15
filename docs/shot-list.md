# Shot list

Target: at or under 3:00, English, public on YouTube or Vimeo. No third-party music. Open on the task desk, then a live meeting, then the 2:17 AM script as one scene.

Mock mode is the right take. If a browser voice is available, leave TTS on for the incident scene.

| Time | Picture | Spoken or on-screen line |
| --- | --- | --- |
| 0:00–0:12 | Task desk, empty state. Click “What did we decide yesterday?” Tool card and the decision in the reply. Task monitor shows the plan. | “Ask it what you decided. It searches the meetings, not a script.” |
| 0:12–0:28 | “Turn yesterday's action items into issues”, then yes. Artifact preview of `issues/`. | “Action items become files. It waits for a yes.” |
| 0:28–0:48 | Start a planning meeting. Tiles, captions, requirement pool. End the meeting. Minutes on the task. | “The room ends. The minutes are already on the task.” |
| 0:48–0:56 | Incident demo. The postmortem room, Priya and Jordan. | “Last night, 2:17 AM. The orders service went down.” |
| 0:56–1:12 | Captions and the pool. 02:17 lands, then 02:15 links to it. | “Logged. 2:17 AM…” then “Correlated: Redis pressure started two minutes before the errors.” |
| 1:12–1:32 | Diff panel. Deploy card v2.3 at 11:40 PM. Red lines for 50 to 20 and the missing timeout. | “Found it — batch-reconcile v2.3… The diff shows the pool was shrunk from 50 to 20.” |
| 1:32–1:52 | Pool: the decision, three requirements, lunch only in chatter, two action items. | “Root cause logged… Two action items captured.” Hold on the lunch line. |
| 1:52–2:12 | Diff panel. Three files, four green tests. | “PR draft ready. Three files changed, tests passing.” |
| 2:12–2:36 | End the meeting. Minutes mention the root cause. Back on the task, the minutes are in the thread. | “The meeting ended. So did the bug.” |
| 2:36–3:00 | Task monitor with the tools that ran. | “Alexa+ is the voice. The MCP server does the work.” |

Do not show a terminal, a README, or a settings page. Judges are not required to watch past three minutes.

## What “good” looks like in frame

- The task desk, not a meeting console, as the first frame.
- A tool card and a plan in the task monitor.
- An issue file preview after a yes.
- Participant tiles, captions, and the requirement pool.
- 02:15 linked to 02:17.
- The deploy card reading v2.3 and 11:40 PM.
- The red diff lines for 50 to 20 and the missing timeout.
- Lunch in chatter, not in the requirement list.
- Three files and four passing tests.
- Minutes posted back on the task.

## Capture notes

- Window at 1440×900 or larger. Below that, the task monitor and the meeting pool sit behind the main column.
- Run `npm run dev` and use the suggestion chips plus **Play the 2:17 script**. Do not type the incident beats live unless you want a five-second microphone insert.
- The model chip should say Mock, unless you have actually configured Bedrock or Nebius and checked a turn.
