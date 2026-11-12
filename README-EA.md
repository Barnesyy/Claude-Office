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
npm rebuild better-sqlite3 esbuild      # only needed if an older checkout skipped install scripts (package.json allowScripts covers npm 12)
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
- Otherwise a tool call with no result after a grace period counts as a wait, if your permission mode and `settings.json` allow rules say it would have asked. The grace is 6 s, or 15 s for Bash and PowerShell, because long MT5 runs are normal.
- In `auto` mode (what the Claude desktop app uses) a slow call is never guessed to be a wait: only the registry or a question tool (AskUserQuestion, ExitPlanMode) raises one. On 6 hours of Jake's real sessions the guess raised 117 false "needs you"; now none.
- When the registry says `busy`, the tool is running, not asking. When it says `idle`, an open turn ends (the desktop app often ends a turn on a chat-reply tool call).
- Registry files whose process is gone are ignored. A desktop thread's name in the registry ("Research School Run settings") becomes the pill title; derived names ("ea-development-58") do not.

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

- `preset: "ea-development"` lists two projects: **EA Dev** (`C:\Users\Barnesy\OneDrive\EA Development`, dir `C--Users-Barnesy-OneDrive-EA-Development`) and **EA Workbench** (`C:\Users\Barnesy\AppData\Local\EAWorkbench`), with `onlyListed: true`.
- Labels: a session in the project root is "EA Dev". One in `EA Development\School Run` is **"EA Dev · School Run"**; deeper than two folders, only the last one shows. The label is the folder the session started in, so it stays put when Claude `cd`s around. Pills are grouped under an `EA DEV` heading, and a session you `/rename` keeps an "EA Dev" chip. Registry-only (grey) pills get the same labels.
- `onlyListed: true` hides everything outside the listed projects. That covers the watcher's events and the registry-only grey pills.
- Environment variables override the config: `AGENT_OFFICE_TRANSCRIPTS_DIR`, `CLAUDE_CONFIG_DIR`, `AGENT_OFFICE_REGISTRY_DIR`, `AGENT_OFFICE_PYTHON`, `AGENT_OFFICE_PORT`, `AGENT_OFFICE_HOME`.
- At start-up, a session active in the last `activeWindowMinutes` has its current turn rebuilt. Older ones join when they next write. A session silent for `idleEndMinutes`, and absent from the registry, ends.

## Chat AI (optional, off)

The chat panel's AI replies (`scripts/chat-ai-watcher.sh`, one `claude -p` per message) are off by default.
The office, the chat and everything else work without them.

- To turn it on, start with `AGENT_OFFICE_CHAT_AI=1` (bash `start-office.sh` only; it needs bash and the `claude` CLI).
- The UI's cron toggle starts paused unless that variable is set.

## Portable release folder

A folder with a `portable-home` file in its root (the release zip has one) keeps its runtime (token, logs, pids,
chat db) in `.agent-office` inside that folder instead of `%USERPROFILE%\.agent-office`. Delete the file to go back.
`package.json` has an `allowScripts` block, so npm 12 runs better-sqlite3's install script (otherwise it is skipped
silently and the server fails on start).

## Replaying real sessions

`scripts/replay-tail.mjs` replays a copy of a real `.claude` folder (its `projects` and `sessions/*.json`) as if it
were happening now: everything up to `--at` at once (timestamps and mtimes moved to now), then the rest on its own clock.

```bash
node scripts/replay-tail.mjs --from <copy of .claude> --to /tmp/live --at 2026-11-12T04:45:00Z --speed 3
AGENT_OFFICE_HOME=/tmp/ao CLAUDE_CONFIG_DIR=/tmp/live node scripts/transcript-watch.mjs --registry-any-pid
```

`--registry-any-pid` trusts registry files whose pid is not running here (they came from another machine).

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
  - **Lesson:** the same command or file failed, then worked, in the same session within 2 h. Rules:
    - The key is the whole normalised command (or tool + file), not just the program name.
    - Both times come from the transcript record, not the wall clock.
    - The failure has to be real: a non-zero exit plus error text. Edit chores ("read it first", "string not found") don't count, and neither do commands made only of probes (`grep`, `rg`, `ls`, `sed`, `cut`, ...).
    - History replayed from before the office started earns no XP and no lessons.
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
- backtest bay: the EA backtest station's crash cart, with an `MT5 runs · WF` plate (see EA scenes)
- equity wall: a `DEMO HIGH` plate under the wall dashboard, from your MT5 account report
- money tree (level 5)

Locked furniture stands under a dust sheet with a padlock. On unlock, the sheet lifts with a star burst.
The four rare unlocks show as `???` until earned.

The level button in the status strip opens the panel. Its tabs are Office, Trophies, Unlocks, Lessons, Today
and Quarter.

Settings → Progression turns it on or off and resets it (UI token).
Progression is loopback only: a LAN phone shows none of it.

## One room: how progression and the EA scenes share it

- **One backtest station.** The EA station (rack + crash cart, left wall) is the only one. The rack and its card always show, so a live run is never hidden.
  With progression on, the cart is the "Backtest bay" unlock: it stands under a dust sheet until your first MT5 tester run, then gets its run-count plate.
- **One equity display.** The whiteboard's EQ mode (the latest tester report's balance curve). The "Equity wall" unlock adds only a brass `DEMO HIGH` plate under the wall dashboard, from a real demo account report.
- **Moved to make room:** Shipped bin and money tree to the front right, the window-box garden along the window past the tick cabinets.
  `tests/integrate-layout.test.ts` checks nothing piles up.

## Desks and the lounge

The office has 10 desks (one is the boss's). Jake often has 12+ live threads plus workers, so:

- **Lounge** (a table and chairs at the front, 8 places): anyone without a desk sits here first, before the wall by the door.
- A Claude between turns there shows no label (its tooltip says "in the lounge"). Only one that needs a desk says "waiting for a desk".
- **Desk handover:** a busy waiter (a worker, or a Claude whose thread is working or needs you) takes the desk of the Claude that has been idle longest, after 60 s idle (`DESK_HANDOVER_IDLE_MS`). That Claude moves to the lounge. A Claude idling in the lunch room can give its desk up too, and comes back to the lounge when its thread is busy again.
- So 16 threads fit with nobody idle queueing. Busy threads beyond 10 desks wait in the lounge until someone goes idle.
- Tests: `tests/office-lounge.test.ts`.

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

### Backtest station: EA Workbench queue (read-only)

- If `ea.workbench` is unset, the station reads `%LOCALAPPDATA%\EAWorkbench`. Set it to a path to use another folder, or to `false` to turn it off.
- Files it reads: `runqueue\queue.json`, `runqueue\config.json` and each campaign's `pipeline_state.json`.
- **Running** means the campaign isn't finished and its owner or terminal process is alive.
- The station shows the queue depth for each tester install, and the latest finished result with its numbers taken from that case's real `.htm` report in the tester's terminal folder. If there is no report, it shows no numbers.
- It never writes there and never starts anything.

### Equity wall: which curve

- **Auto** shows the newest completed report of the strategy being worked on:
  - a session's own tester run shows at once;
  - otherwise the Workbench's newest run of that EA.
- A different report only replaces the current one after `ea.equityDwellMinutes` (default 10) on the wall.
- The caption names the EA, symbol, period and date range.
- The picker on the wall pins one of the 14 newest reports, or goes back to Auto. It only works on the loopback page with the UI token. The pin is kept in `<home>/ea-equity.json`.

### Stale needs-you

- A session waiting on you for more than 6 h moves to a separate **stale (>6h)** bucket, so it no longer inflates the main count.
- Where it appears: the status strip, the Command Centre's "Stale >6h" column, and pills that are faded and sorted last.
- Each needs-you pill and tooltip shows how long it has waited.

- Fixtures: `tests/fixtures/ea/` (regenerate with `node tests/fixtures/ea/make-ea-fixtures.mjs`).
- Tests: `tests/ea-scenes.test.ts`, `tests/ea-office.test.ts`, `tests/ea-scenes-ui.test.ts`, `tests/ea-polish.test.ts`.

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
