#!/usr/bin/env node
/**
 * transcript-watch.mjs — the hookless data source: tails Claude Code's JSONL
 * transcripts and feeds the office the same events the hooks would
 * (server/transcript-source.js). Installs nothing into Claude Code.
 *
 *   node scripts/transcript-watch.mjs                 watch ~/.claude/projects (or the configured dir)
 *   node scripts/transcript-watch.mjs --dir <path>    watch another projects dir
 *   node scripts/transcript-watch.mjs --dry-run       print the office events instead of POSTing them
 *   node scripts/transcript-watch.mjs --from-start    read existing files from the start (replays)
 *   node scripts/transcript-watch.mjs --once          one pass, then exit (with --from-start: a replay)
 *   node scripts/transcript-watch.mjs --js            built-in converter even when Python is there
 *
 * Settings: the `transcripts` block of office.config.json (see README-EA.md).
 * Environment: AGENT_OFFICE_PORT, AGENT_OFFICE_HOME (token + pid file),
 * AGENT_OFFICE_TRANSCRIPTS_DIR, CLAUDE_CONFIG_DIR, AGENT_OFFICE_PYTHON.
 */
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { TranscriptWatcher, resolveTranscriptConfig, createConverter } from '../server/transcript-source.js'
import { readOfficeConfig, readPort } from '../server/config.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

const RUNTIME_DIR = process.env.AGENT_OFFICE_HOME || join(homedir(), '.agent-office')
const PORT = readPort()
const EVENT_URL = process.env.AGENT_OFFICE_EVENT_URL || `http://127.0.0.1:${PORT}/event`
const dryRun = flag('--dry-run')
const once = flag('--once')

const officeConfig = readOfficeConfig(value('--config-dir') || ROOT)
const config = resolveTranscriptConfig(officeConfig)
if (value('--dir')) config.dir = value('--dir')
if (flag('--all-projects')) config.onlyListed = false

function token() {
  try { return readFileSync(join(RUNTIME_DIR, 'auth-token'), 'utf8').trim() } catch { return '' }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function post(event) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const res = await fetch(EVENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(event),
      })
      if (res.ok) return
      if (res.status === 400) { console.warn(`[transcripts] office refused ${event.type}: ${await res.text()}`); return }
      if (res.status !== 401) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      if (attempt === 0) console.warn(`[transcripts] office not reachable (${err.message}); retrying`)
    }
    await sleep(Math.min(500 * (attempt + 1), 3000))
  }
  console.warn(`[transcripts] gave up on ${event.type}`)
}

const sink = dryRun
  ? events => { for (const e of events) process.stdout.write(JSON.stringify(e) + '\n') }
  : async events => { for (const e of events) await post(e) }

const converter = createConverter({ forceJs: flag('--js') })
const watcher = new TranscriptWatcher({ config, converter, sink, fromStart: flag('--from-start') })

const pidFile = join(RUNTIME_DIR, 'transcript-watch.pid')
function cleanup() {
  watcher.stop()
  converter.close()
  if (!dryRun && !once) try { if (readFileSync(pidFile, 'utf8').trim() === String(process.pid)) unlinkSync(pidFile) } catch {}
}

console.error(`[transcripts] watching ${config.dir} (${converter.kind} converter${config.onlyListed ? `, only ${config.projects.map(p => p.name).join(', ')}` : ''})${dryRun ? ' [dry run]' : ` -> ${EVENT_URL}`}`)

if (once) {
  watcher.tick()
  await watcher.flush()
  // Let the quiet checks see the files settle (turn ends, permission waits)
  await sleep(50)
  cleanup()
  console.error(`[transcripts] done: ${watcher.stats.payloads} payloads, ${watcher.stats.events} events`)
  process.exit(0)
} else {
  if (!dryRun) { try { mkdirSync(RUNTIME_DIR, { recursive: true }); writeFileSync(pidFile, String(process.pid)) } catch {} }
  watcher.start()
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => { cleanup(); process.exit(0) })
  process.on('exit', cleanup)
}
