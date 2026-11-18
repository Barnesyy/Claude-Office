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

## Other agents: Codex and Grok

The office is not only Claude's. The same watcher reads two more tools' session files and seats their
threads in the same room (`server/provider-sources.js`). Nothing is installed into either tool and nothing in
their folders is written.

| Tool | Reads | Status |
| --- | --- | --- |
| **Codex** (desktop app, IDE extension, CLI) | `%USERPROFILE%\.codex\sessions\YYYY\MM\DD\rollout-*.jsonl` | Built from Codex's published format (openai/codex). Covers threads, prompts, tool calls, worker threads, turn ends and interrupts. |
| **Grok** (CLI) | `%USERPROFILE%\.grok\sessions\<folder>\<session id>\updates.jsonl`, with `events.jsonl` and `summary.json` beside it | Built from real Grok 4.7 sessions. Covers sessions, titles, prompts, tool calls, failed calls, turn ends, cancels and open permission prompts. |

How it works:

- Each tool's records are turned into Claude Code's transcript shape, then go down the unchanged pipeline.
  So a Codex shell call that runs `terminal64.exe /config:…` lights the backtest station, a Codex edit of an
  `.mq5` shows MetaEditor on the desk, and its turns, workers, commits and MT5 runs earn progression by the same rules.
- Session ids carry the tool as a prefix (`codex-…`, `grok-…`), and the server keeps `provider` on the session.
- In the room, a Codex or Grok thread is Claude's sprite with a tint (green for Codex, grey for Grok) and its
  name on the tag under it. Its pill in the strip has a `Codex` or `Grok` chip, and its chat lines are signed with its name.

What is different from Claude:

- **Needs you:** Grok writes down when a permission prompt opens and when it is answered (`events.jsonl`), so its hand
  goes up for a real prompt only. Codex does not write its approval dialogs down, and a slow call is never guessed
  to be one (the guess was wrong 117 times in 6 hours on Claude, see above), so a Codex thread never shows needs-you.
- **Turn end:** both write it down (Codex `turn_complete`, Grok `turn_completed`), so none is guessed.
- **Meters** (cost, tokens, context) and the inspector's transcript tail are Claude only for now.
- By default every Codex and Grok thread shows, whatever folder it runs in (a Codex thread may run in a worktree
  outside the listed projects). A thread inside a listed project still gets its label (`EA Dev · School Run`).

Config (`office.config.json`, all optional):

```json
{
  "providers": {
    "codex": { "enabled": true, "dir": null, "onlyListed": false, "scanDays": 30 },
    "grok": { "enabled": true, "dir": null, "onlyListed": false, "scanDays": 30 }
  }
}
```

- `enabled: false` turns a tool off. `dir` names another sessions folder. `onlyListed: true` hides threads outside the listed projects.
- `scanDays`: only session files from the last 30 days are looked at.
- Environment: `CODEX_HOME`, `GROK_HOME`, `AGENT_OFFICE_CODEX_DIR`, `AGENT_OFFICE_GROK_DIR`.
- Watcher flags: `--no-providers`, `--codex-dir <path>`, `--grok-dir <path>`. A scratch run (`--dir` or
  `AGENT_OFFICE_TRANSCRIPTS_DIR`) watches another tool only when its folder is named too.

Demo (fixture sessions, not real ones):

```bash
AGENT_OFFICE_HOME=/tmp/ao AGENT_OFFICE_PORT=3434 node server/index.js
AGENT_OFFICE_HOME=/tmp/ao AGENT_OFFICE_PORT=3434 node scripts/transcript-watch.mjs --once --from-start --dir /nonexistent \
  --codex-dir tests/fixtures/providers/codex/sessions --grok-dir tests/fixtures/providers/grok/sessions
```

Adding another tool is one entry in `PROVIDERS`: a `scan` that finds its session files and an adapter that
turns its records into `user` / `assistant` rows. Tests: `tests/provider-sources.test.ts`.

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

## Progression (cash, XP, trophies, shop)

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

The rules live in `server/progression.js` (`XP_BASE`, `CASH_BASE`, `TRACKS`, `MILESTONES`, `UNLOCKS`). The store is SQLite tables
`progression_*` in `chat.db`. Broadcasts are `progression_update`, `progression_award`, `progression_reset` and
`progression_settings`.

### The firm: cash and the shop

The office is a trading firm. It earns cash, and the cash buys what stands in the room.
Nothing is in the room until it is bought: no dust sheets, no padlocks, just a bare office.

Cash comes in from three places (`CASH_BASE`, `BREAKTHROUGH`, `PROFIT_SHARE` in `server/progression.js`):

- **Work.** Every fact that earns XP also pays, with the same anti-farming rules. Per first one of the day:
  turn $5, worker $10, tests pass $10, build $5, EA compile $15, commit $20, push $20, lesson $80,
  MT5 run $60, tester report $30, deploy $100, PR merge $150, walk-forward $250.
- **Breakthroughs.** When a finished tester report beats the best one so far for the same expert, symbol and
  period, the firm gets a $400 bonus. The score is net profit over max drawdown. It needs at least 30 trades
  and a 2% improvement, the first report only sets the baseline, and at most 3 are paid a day.
- **Account profits.** Each new equity high on a watched MT5 account pays a share of the gain: 10% on a demo
  account, 50% on a live one. The first reading is only the baseline, and a drawdown costs nothing.
  An account counts as live when its login is listed in `progression.liveAccounts`:

  ```json
  { "progression": { "liveAccounts": ["12345678"] } }
  ```

The shop is the Shop tab of the panel (the level button in the status strip). Buying needs the office's own
link (`npm run open`); a plain `127.0.0.1` tab and a phone are read-only.

| Piece | Price | What it does |
| --- | --- | --- |
| Trophy cabinet | $250 | trophies, XP bar and level plate |
| Mailbox | $400 | flag up while there are unseen awards |
| Lessons binder | $600 | every fail-then-fix, filed |
| Shipped bin | $900 | a parcel per merged PR or deploy |
| Backtest bay | $1,500 | crash cart at the rack with an `MT5 runs · WF` plate (see EA scenes) |
| Equity plate | $2,000 | `DEMO HIGH` plate under the wall dashboard |
| Window garden | $2,500 | a plant per merged PR |
| Money tree | $5,000 | it looks like it might grow money |

The four rare finds are earned, not bought, and show as `???` until then.
The Shop tab also lists the last money in and out (table `progression_ledger`).
Anything unlocked under the old level rules stays in the room; a reset in Settings empties it.

The level button in the status strip shows the balance and opens the panel. Its tabs are Firm, Shop, Trophies,
Lessons, Today and Quarter.

Settings → Progression turns it on or off and resets it (UI token).
Progression is loopback only: a LAN phone shows none of it.

## One room: how progression and the EA scenes share it

- **One backtest station.** The EA station (rack + crash cart, left wall) is the only one. The rack and its card always show, so a live run is never hidden.
  With progression on, the cart is the "Backtest bay" shop piece: the spot is empty until you buy it, then it carries its run-count plate.
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
- "The EA being worked on" means builds of the same EA by name. For the Workbench, it also means any report that build's runs wrote: in their tester folders, since each run started. That covers an EA whose report gives a different name from its file (`EA_BrooksPA_BlackBull.ex5` reports itself as `BPASDR16Twin`).
- Auto looks through the newest 60 results, then more widely: the Workbench's own run-to-report mapping (a run's last case and run name, in that tester's folder) and a deeper walk of the reports folder, so a report is still found under a flood of other EAs' results. As soon as that EA has a finished report, the wall switches to it (after the dwell) and keeps it over newer reports of other EAs.
- If that EA still has no report, Auto keeps showing the newest of all and says so: `AUTO · newest (no report yet for <EA>)`.
- The picker lists one entry per result: the same run saved as .htm and .xml, or copied into another tester folder, is folded into one ("+1 copy"). Each entry names its file and tester folder (the Workbench install name when known). ◆ marks reports of the EA being worked on.
- The picker on the wall pins one of the 14 newest reports (plus the focus EA's newest, if it is older), or goes back to Auto. It only works on the loopback page with the UI token. The pin is kept in `<home>/ea-equity.json`.

### Stale needs-you

- A session waiting on you for more than 6 h moves to a separate **stale (>6h)** bucket, so it no longer inflates the main count.
- Where it appears: the status strip, the Command Centre's "Stale >6h" column, and pills that are faded and sorted last.
- Each needs-you pill and tooltip shows how long it has waited. Within a project group, pills are ordered: fresh needs-you (the most recent first), then the rest by start time, then stale needs-you, then ended.

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
