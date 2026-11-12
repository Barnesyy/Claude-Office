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
 *   node scripts/transcript-watch.mjs --no-progression  don't send progression facts (commits, PR merges,
 *                                                     MT5 runs, lessons) to POST /progression/facts
 *   node scripts/transcript-watch.mjs --registry-any-pid   trust every registry file, live pid or not
 *                                                     (replaying another machine's ~/.claude/sessions)
 *
 * Settings: the `transcripts` block of office.config.json (see README-EA.md).
 * Environment: AGENT_OFFICE_PORT, AGENT_OFFICE_HOME (token + pid file),
 * AGENT_OFFICE_TRANSCRIPTS_DIR, CLAUDE_CONFIG_DIR, AGENT_OFFICE_PYTHON,
 * AGENT_OFFICE_CONFIG_DIR (where office.config.json is, as for the server).
 */
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { TranscriptWatcher, resolveTranscriptConfig, createConverter } from '../server/transcript-source.js'
import { readOfficeConfig, readPort } from '../server/config.js'
import { FactExtractor } from '../server/progression-facts.js'
import { isEaRelevant, slimPayload } from '../server/ea-scenes.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

const RUNTIME_DIR = process.env.AGENT_OFFICE_HOME || join(homedir(), '.agent-office')
const PORT = readPort()
const EVENT_URL = process.env.AGENT_OFFICE_EVENT_URL || `http://127.0.0.1:${PORT}/event`
// The EA scenes (server/ea-scenes.js): tool calls about MT5 runs, .mq5 / .set files and tick data
const EA_URL = process.env.AGENT_OFFICE_EA_URL || EVENT_URL.replace(/\/event$/, '/ea/payload')
const dryRun = flag('--dry-run')
const once = flag('--once')

const officeConfig = readOfficeConfig(value('--config-dir') || process.env.AGENT_OFFICE_CONFIG_DIR || ROOT)
const config = resolveTranscriptConfig(officeConfig)
if (value('--dir')) config.dir = value('--dir')
if (flag('--all-projects')) config.onlyListed = false

function token() {
  try { return readFileSync(join(RUNTIME_DIR, 'auth-token'), 'utf8').trim() } catch { return '' }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function post(event, url = EVENT_URL) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const res = await fetch(url, {
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

// EA payloads go in small batches, in order, on their own queue (POST /ea/payload)
let eaBatch = []
let eaChain = Promise.resolve()
let eaTimer = null
function flushEa() {
  eaTimer = null
  const payloads = eaBatch.splice(0)
  if (payloads.length) eaChain = eaChain.then(() => post({ type: 'ea_payloads', payloads }, EA_URL))
  return eaChain
}
function onEaPayload(p) {
  if (!isEaRelevant(p)) return
  const slim = slimPayload(p)
  if (dryRun) { process.stdout.write(JSON.stringify({ ea: slim }) + '\n'); return }
  eaBatch.push(slim)
  if (eaBatch.length >= 40) flushEa()
  else eaTimer ??= setTimeout(flushEa, 250)
}

const converter = createConverter({ forceJs: flag('--js') })

// The progression layer's tap (server/progression-facts.js): what the tool
// calls meant (commits, PR merges, MT5 tester runs, fail-then-fix lessons),
// as small facts with no command text or output. The Python tracker already
// signals builds, tests and pushes; the built-in converter does not, so then
// the extractor reads those too.
const PROGRESSION_URL = EVENT_URL.replace(/\/event$/, '/progression/facts')
const extractor = flag('--no-progression') ? null : new FactExtractor({ withSignals: converter.kind !== 'js' })
let factQueue = Promise.resolve()
async function postFacts(facts) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(PROGRESSION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ facts }),
      })
      // 404: an office without the progression layer; nothing to retry
      if (res.ok || res.status === 404 || res.status === 400) return
    } catch {}
    await sleep(1000 * (attempt + 1))
  }
}
function onProgressionPayload(p) {
  if (!extractor) return
  const facts = extractor.facts(p)
  if (!facts.length) return
  if (dryRun) { for (const f of facts) process.stdout.write(JSON.stringify({ progression: f }) + '\n'); return }
  // In order, after the events of the same payload had their turn
  factQueue = factQueue.then(() => watcher.flush()).then(() => postFacts(facts)).catch(() => {})
}

// One payload tap feeds both layers; one failing never stops the other
function onPayload(p) {
  try { onEaPayload(p) } catch (err) { console.error('[transcripts] ea tap:', err?.message ?? err) }
  try { onProgressionPayload(p) } catch (err) { console.error('[transcripts] progression tap:', err?.message ?? err) }
}

const watcher = new TranscriptWatcher({ config, converter, sink, fromStart: flag('--from-start'), onPayload,
  ...(flag('--registry-any-pid') ? { alive: () => true } : {}) })

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
  await flushEa()
  await factQueue
  // Let the quiet checks see the files settle (turn ends, permission waits)
  await sleep(50)
  cleanup()
  console.error(`[transcripts] done: ${watcher.stats.payloads} payloads, ${watcher.stats.events} events`)
  process.exit(0)
} else {
  if (!dryRun) { try { mkdirSync(RUNTIME_DIR, { recursive: true }); writeFileSync(pidFile, String(process.pid)) } catch {} }
  watcher.start()
  // Why: the watcher's poll timer is unref'd (it also runs inside tests); with
  // the built-in converter nothing else would keep this process alive
  setInterval(() => {}, 1 << 30)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => { cleanup(); process.exit(0) })
  process.on('exit', cleanup)
}
