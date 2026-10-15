# Shot list

Target: at or under 3:00, English, public on YouTube or Vimeo. No third-party music. Open on the meeting home. The working session is the main scene. The 2:17 AM script is one later scene. The task desk is a short cutaway.

Mock mode is the right take. If a browser voice is available, leave TTS on.

| Time | Picture | Spoken or on-screen line |
| --- | --- | --- |
| 0:00–0:12 | Meeting home. Start, Join, Schedule, personal code, recent list. | “This is the meeting. Start one, or come back to one you already held.” |
| 0:12–0:22 | Start meeting. Four tiles: You, Maya, Chris, Priya. Empty agent panel. | “The room is up. The agent is listening.” |
| 0:22–0:48 | Play a working session. Goal line. Plan card appears. | “Goal for this meeting: ship the billing export as a nightly job.” |
| 0:48–1:12 | Architecture and API cards, then the settings wireframe card. | “The sketch and the settings screen land while they are still talking.” |
| 1:12–1:22 | Lunch caption. Chatter line in the panel, not a plan card. | “Lunch stays parked.” |
| 1:22–1:42 | Feasibility and research cards. Suggestion citing the nightly job. | “It checks the idea against what you already decided.” |
| 1:42–1:55 | “Waiting for a yes” on the scaffold. Then yes. | “Tests do not run until someone says yes.” |
| 1:55–2:10 | End meeting. Minutes include the agent work. | “The notes leave with the meeting.” |
| 2:10–2:28 | Incident demo. Play the 2:17 script through the diff and the green tests. | “The same room can still run last night’s postmortem.” |
| 2:28–2:45 | Task desk, one thread, yesterday’s decision. | “The desk is still there when you want a thread instead of a room.” |
| 2:45–3:00 | Back on the agent panel, cards still visible. | “Alexa+ is the voice. The MCP server does the work.” |

Do not show a terminal, a README, or a settings page. Judges are not required to watch past three minutes.

## What “good” looks like in frame

- The meeting home as the first frame.
- Four participant tiles and captions with speaker labels.
- Plan, architecture, wireframe, API, feasibility, and research cards.
- A suggestion that mentions the nightly job without anyone asking for it.
- Lunch in the parked line, not in the plan.
- A yes still required before the scaffold and the tests.
- The 2:17 AM diff, with the pool shrunk from 50 to 20, as one later beat.
- The task desk as a secondary screen.

## Capture notes

- Window at 1440×900 or larger so the agent panel sits on the right.
- Run `npm run dev`, start a meeting, and use **Play a working session**. Use **Incident demo** only for the postmortem beat.
- The model stays on Mock unless Bedrock or Nebius is actually configured.
