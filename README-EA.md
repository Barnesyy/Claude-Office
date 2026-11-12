# Claude Office — EA Development fork

Jake's fork of [W17ant/Claude-Office](https://github.com/W17ant/Claude-Office) (branch `ea-dev`).
It keeps upstream's pixel art and office, and changes how it is fed and what it shows:

- **Hookless by default.** It reads Claude Code's own transcripts. Nothing is installed into Claude Code.
- **Project focus.** The EA Development folder gets readable labels, and pills are grouped by project.
- **Trading Floor theme** (`/trading-floor`). It replaces upstream's Dunder Mifflin fan art, so everything here is MIT.
- **Chat AI off by default.** Nothing calls `claude -p` unless you turn it on.
- **Windows start/stop with no console windows.** The stop script only stops processes the start script started.

## Setup (once)

```powershell
cd "C:\Users\Barnesy\OneDrive\EA Development\Claude-Office"   # wherever you cloned it
npm ci
npm rebuild better-sqlite3 esbuild      # npm 11 skips install scripts; this builds the two native bits
copy office.config.ea.example.json office.config.json   # start-office.ps1 does this if it's missing
```

Node 20+ is required. Python 3 is optional: with it, the watcher runs upstream's own
`hooks/agent-tracker.py` for exact hook-mode events (build/test/push signals and role
guesses). Without it, a built-in converter covers the core events.

## Run on Windows (hidden)

| | |
| --- | --- |
| Start | double-click `scripts\windows\start-office.vbs` (no window at all), or `powershell -File scripts\windows\start-office.ps1` |
| Stop | `scripts\windows\stop-office.vbs` or `stop-office.ps1` |
| Office | opens in your browser with its token: `http://127.0.0.1:3334/` |
| Logs | `%USERPROFILE%\.agent-office\logs\` (`server.log`, `transcript-watch.log`, `build.log`, `start-office.log`) |
| PIDs | `%USERPROFILE%\.agent-office\win-office-pids.json` |

What `start-office.ps1` does:

1. Builds the UI once (`vite build`, hidden; `-Build` forces a rebuild). The server serves `dist\`, so no Vite dev server runs.
2. Starts `node server\index.js` and `node scripts\transcript-watch.mjs` through `scripts\windows\spawn-hidden.mjs`. That launcher gives each process its own hidden console (`detached` + `windowsHide`), BelowNormal priority and log files, so closing a terminal doesn't stop them.
3. Records each pid with its start time and full script path. `stop-office.ps1` stops a pid only when both still match, plus the watcher's Python bridge child. It never stops a node process it didn't start.
4. Options: `-NoBrowser`, `-Hooks` (no watcher), `-Build`.

It never creates autostart entries, scheduled tasks or hooks. If you want it at logon, set that up yourself.

On macOS/Linux, `bash scripts/start-office.sh` runs the same pieces: the server, Vite dev, and the
transcript watcher by default. `scripts/stop-office.sh` stops them by pid file.

## Data sources

| Mode | How | Notes |
| --- | --- | --- |
| **Transcripts** (default) | `scripts/transcript-watch.mjs` tails `~/.claude/projects/**.jsonl` (`%USERPROFILE%\.claude\projects`) | Read-only. Covers session start and end, prompts, tool calls, subagent spawn and finish (foreground and background), failed tools, interrupts, permission waits and idle. |
| Hooks (opt-in) | `npm run install-hooks` (by hand, your choice), then start with `AGENT_OFFICE_SOURCE=hooks` or `-Hooks` | Upstream's original path. It's exact for permission dialogs and can answer them from the office. |

**How permission waits are inferred** (transcripts don't record dialogs):

- When `~/.claude/sessions/<pid>.json` says `waiting`, a dialog is open, and the session shows "needs you" right away.
- Otherwise a tool call with no result after a grace period counts as a wait, if your permission mode and `settings.json` allow rules say it would have asked. The grace is 6 s, or 15 s for Bash, because long MT5 runs are normal.
- When the registry says `busy`, the tool is running, not asking.

The transcript watcher removes anything that would let the office answer a dialog. In transcript mode the office can only show waits, not answer them.

## Configuration (`office.config.json`)

```json
{
  "boss": { "name": "Jake", "sprite": "Me-1", "color": "#28c840", "emoji": "crown" },
  "transcripts": {
    "preset": "ea-development",
    "dir": null,
    "projects": [{ "name": "EA Dev", "path": "C:\\Users\\Barnesy\\OneDrive\\EA Development" }],
    "onlyListed": true,
    "activeWindowMinutes": 20,
    "idleEndMinutes": 45,
    "permissionGraceSeconds": 6,
    "bashPermissionGraceSeconds": 15,
    "turnIdleSeconds": 4,
    "pollMs": 700
  }
}
```

- `preset: "ea-development"` is the same as the `projects` and `onlyListed` shown above. That folder's encoded dir is `C--Users-Barnesy-OneDrive-EA-Development`.
- Labels: a session in the project root is "EA Dev". One in `EA Development\School Run` is **"EA Dev · School Run"**. Pills are grouped under an `EA DEV` heading, and a session you `/rename` keeps an "EA Dev" chip.
- `onlyListed: true` hides everything outside the listed projects. That covers the watcher's events and the registry-only grey pills.
- Environment variables override the config: `AGENT_OFFICE_TRANSCRIPTS_DIR`, `CLAUDE_CONFIG_DIR`, `AGENT_OFFICE_REGISTRY_DIR`, `AGENT_OFFICE_PYTHON`, `AGENT_OFFICE_PORT`, `AGENT_OFFICE_HOME`.
- At start-up, a session active in the last `activeWindowMinutes` has its current turn rebuilt. Older ones join when they next write. A session silent for `idleEndMinutes`, and absent from the registry, ends.

## Chat AI (optional, off)

The chat panel's AI replies (`scripts/chat-ai-watcher.sh`, one `claude -p` per message) are off by default.
The office, the chat and everything else work without them.

- To turn it on, start with `AGENT_OFFICE_CHAT_AI=1` (bash `start-office.sh` only; it needs bash and the `claude` CLI).
- The UI's cron toggle starts paused unless that variable is set.

## Replay demo (no Claude needed)

```bash
# terminal 1: office on a spare port with a scratch home
AGENT_OFFICE_HOME=/tmp/ao AGENT_OFFICE_PORT=3434 node server/index.js
# terminal 2: watcher on a scratch projects dir
AGENT_OFFICE_HOME=/tmp/ao AGENT_OFFICE_PORT=3434 AGENT_OFFICE_TRANSCRIPTS_DIR=/tmp/ao/replay-projects node scripts/transcript-watch.mjs
# terminal 3: play the fixtures (3 sessions, 2 workers, 2 permission waits) into it
AGENT_OFFICE_HOME=/tmp/ao node scripts/replay-transcripts.mjs --loop
```

Open `http://127.0.0.1:3434/` (`npm run build` first, or run Vite). The fixtures are in `tests/fixtures/transcripts`.
Regenerate them with `node tests/fixtures/make-transcripts.mjs`.

## Tests

```bash
npx tsc --noEmit -p .   # type check (the repo has no separate linter)
npx vitest run          # full suite
npm run check-assets    # every referenced sprite exists; nothing unreferenced
npx vite build
```

- The fork's own tests are `tests/transcript-source.test.ts` (fixtures, labels, permission inference, the Python bridge) and `tests/transcript-e2e.test.ts` (watcher → `/event` → WebSocket, event taps, registry focus).
- A full run deletes `build/icon.png` (an upstream test quirk). Restore it with `git checkout build/icon.png`.

## Progression (XP, trophies, unlocks)

The office levels up from real work only. Each source:

- **Turns and workers:** from the event tap (`session_turn_end`, `agent_completed`).
  A worker whose result is `failed: …`, `stopped`, `session ended` or `went quiet` earns nothing.
- **Tests, builds, pushes, deploys:** the Python tracker's `signal`s.
- **Commits, PR merges, MT5 runs, EA compiles, lessons:** the transcript watcher reads these from tool calls
  (`server/progression-facts.js`) and posts them to `POST /progression/facts` (office token).
  - **MT5 tester runs:** a foreground `terminal64 /config:<ini>` call that finished.
  - **Walk-forward:** `ForwardMode>0` in that ini, read on this PC. If the ini can't be read, the run counts
    as walk-forward only when the file name says so (`wf`, `walk-forward`, `forward`).
  - **Tester report:** counts when the ini's `Report=` file was written during the run.
  - **Lesson:** the same command or file failed, then worked, in the same session within 2 h.
- **Demo equity highs:** only from a real MT5 account report on a demo account (see config below).
  No report means no number. The first reading is the baseline.

Anti-farming:

- XP for a kind shrinks with each repeat in a day: `base / (1 + 0.35 n)`.
- Each kind is capped at 8× its base per day.
- The same thing again within 90 s counts nothing.
- Replays are deduped by id.
- Failures earn 0 XP.

The rules live in `server/progression.js` (`XP_BASE`, `TRACKS`, `MILESTONES`, `UNLOCKS`). The store is SQLite tables
`progression_*` in `chat.db`. Broadcasts are `progression_update`, `progression_award`, `progression_reset` and
`progression_settings`.

In the room:

- trophy cabinet with an XP bar and level plate
- mailbox (flag up while there are unseen awards)
- lessons binder
- Shipped bin (a parcel per merged PR or deploy)
- window-box garden (a plant per merged PR)
- backtest bay, equity wall and money tree

Locked furniture stands under a dust sheet with a padlock. On unlock, the sheet lifts with a star burst.
The four rare unlocks show as `???` until earned.

The level button in the status strip opens the panel. Its tabs are Office, Trophies, Unlocks, Lessons, Today
and Quarter.

Settings → Progression turns it on or off and resets it (UI token).
Progression is loopback only: a LAN phone shows none of it.

## EA scenes

Read from the watcher only (the hookless `onPayload` tap → `POST /ea/payload`, token required). Hooks mode doesn't feed them.
They are display only: no scene runs or changes anything.

- **MT5 backtest station** (rack + crash cart, left wall).
  - Lights while a Bash/PowerShell call runs `terminal64.exe /config:…` (tester) or `metaeditor64.exe /compile:…`.
  - When the tester ends, the card shows net profit, max drawdown and trades **read from the tester report** (`Report=` in the ini, then the reports folder).
  - No readable report gives "report not found" with the reason. It never shows a number it did not read.
  - Compile errors turn the rack red, with error and warning counts from the `/log` file.
- **Equity wall.** The whiteboard cycles **To-do / Kanban / Balance curve / EA ticker** (12 s each, only modes with content).
  - Click a tab to hold a mode; click again to release it. Hover the board for a big readable copy.
  - The curve is the balance column of the latest report (from a run the office saw, or the newest in `ea.reportsDir`).
  - With no report it shows an empty state.
- **Command Centre.** The `CMD` button in the title bar (or `?centre`) shows every session in Needs you / Working / Done / Ended. Esc closes it.
- **Desk screens.** A worker touching `.mq5` gets MetaEditor + a DAX chart. A `.set` or tester ini gets the Strategy Tester + DAX.
  These are pictures, not data. Preview them with `?screens=dax|mql|tester`.
- **Tick-data cabinets.** Calls that fetch or name tick data for years (e.g. `--from 2019 --to 2023`) put up to 3 filing cabinets by the window, plated by year (runs like `2019–20` when there are more).
- **Risk badge.** An `.mq5` edit whose changed lines touch lot sizing, risk % or stop-loss code floats an amber `LOTS·RISK·SL` flag over that worker for 30 min.
  Info only; no code is sent to the page.

Config (`office.config.json`, all optional):

```json
{
  "progression": {
    "enabled": true,
    "equityReports": ["C:\\Users\\Barnesy\\Documents\\MT5 reports"],
    "demoAccounts": ["5012345"],
    "equityPollMinutes": 10
  },
  "ea": {
    "reportsDir": "C:\\Users\\Barnesy\\AppData\\Roaming\\MetaQuotes\\Terminal\\<id>\\reports",
    "terminalDataDirs": [],
    "reportWaitMinutes": 20,
    "screenMinutes": 10,
    "riskMinutes": 30,
    "cabinetMinutes": 60,
    "rescanSeconds": 30
  }
}
```

Progression:

- `enabled: false` turns it off at server start.
- `equityReports` takes files or folders of MT5 History → Report HTML exports (UTF-16 is fine).
  - A reading counts when the report's Account line names a Demo server, or its login is in `demoAccounts`.
  - Strategy Tester reports are never read as equity.
- Watcher: `node scripts/transcript-watch.mjs --no-progression` sends no facts.
- Replay demo: `node scripts/transcript-watch.mjs --dir tests/fixtures/progression-transcripts --once --from-start --all-projects`.
- Sprites: `python3 scripts/generate-progression-sprites.py`. Credits are in `docs/progression-credits.md`.

EA scenes:

- `AGENT_OFFICE_EA_REPORTS_DIR` overrides `reportsDir`.
- Reports, inis and logs may be UTF-16 (MT5's default).
- EA state, including file paths, is not sent to read-only (LAN) viewers. `GET /ea/state` includes paths only with the token.

Demo (fixture numbers, **not real results**; expert `SchoolRun_FIXTURE`):

```bash
AGENT_OFFICE_HOME=/tmp/ao AGENT_OFFICE_PORT=3434 node server/index.js
AGENT_OFFICE_HOME=/tmp/ao AGENT_OFFICE_PORT=3434 node scripts/transcript-watch.mjs --dir /tmp/ao/proj --all-projects
node scripts/ea-demo.mjs --to /tmp/ao/proj [--with-fixtures] [--no-report] [--hold-tester 30]
```

- Fixtures: `tests/fixtures/ea/` (regenerate with `node tests/fixtures/ea/make-ea-fixtures.mjs`).
- Tests: `tests/ea-scenes.test.ts`, `tests/ea-office.test.ts`, `tests/ea-scenes-ui.test.ts`.

## Hooking in a progression layer

`server/event-taps.js` is the seam: `addEventTap(fn)` gets every payload the office broadcasts, after the server
has applied it, in order. Some of those payloads:

- `agent_spawned` / `agent_completed`
- `session_prompt` / `session_turn_end`
- `session_needs_you`
- `signal`: deploy, build, test and push, from the Python tracker
- `incident_*`

The watcher also has an `onPayload` tap with the rebuilt hook payloads (tool names, inputs, results).
A progression module can keep its own store under `~/.agent-office`. It can show rewards by broadcasting its own event type,
for example `{ type: 'progression_award' }`.

## Licence

Everything on this branch is MIT. See [NOTICE.md](NOTICE.md) for what was removed.

- The Trading Floor props in `public/sprites/trading/props/` are new art, drawn to match upstream's style.
- The cast are names over upstream's own MIT sprites.
