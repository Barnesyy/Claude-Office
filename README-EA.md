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
