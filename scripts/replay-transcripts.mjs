#!/usr/bin/env node
/**
 * replay-transcripts.mjs — plays a set of Claude Code transcripts back into a
 * projects dir line by line, on their own clock, so the transcript watcher
 * sees sessions start, workers spawn, permission dialogs wait and turns end
 * as if Claude Code were writing them now. For demos and end-to-end checks.
 *
 *   node scripts/replay-transcripts.mjs [--from tests/fixtures/transcripts] [--to <dir>] [--speed 1] [--loop]
 *
 * Records play on their own timestamps (one gap at most --max-gap-ms, 12 s),
 * so a permission dialog's silence is really there for the watcher to infer. Then point the
 * office at the target: AGENT_OFFICE_TRANSCRIPTS_DIR=<dir> (README-EA.md).
 */
import { readdirSync, readFileSync, mkdirSync, appendFileSync, rmSync, statSync } from 'fs'
import { join, dirname, relative } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const FROM = value('--from', join(ROOT, 'tests', 'fixtures', 'transcripts'))
const TO = value('--to', join(process.env.AGENT_OFFICE_HOME || join(homedir(), '.agent-office'), 'replay-projects'))
const SPEED = Number(value('--speed', '1')) || 1
const LOOP = args.includes('--loop')
// Records play on their own clock (the fixtures span ~40 s), any one gap capped
const MAX_GAP = Number(value('--max-gap-ms', '12000')) || 12000

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function once() {
  rmSync(TO, { recursive: true, force: true })
  mkdirSync(TO, { recursive: true })
  const rows = []
  for (const file of walk(FROM)) {
    const rel = relative(FROM, file)
    readFileSync(file, 'utf8').split('\n').filter(Boolean).forEach((line, i) => {
      let t = NaN
      try { t = Date.parse(JSON.parse(line).timestamp) } catch {}
      rows.push({ rel, line, i, t })
    })
  }
  // Untimed rows (summary) go first in their file; then everything by time
  const t0 = Math.min(...rows.filter(r => Number.isFinite(r.t)).map(r => r.t))
  rows.forEach(r => { if (!Number.isFinite(r.t)) r.t = t0 - 1 })
  rows.sort((a, b) => a.t - b.t || (a.rel === b.rel ? a.i - b.i : 0))
  console.log(`[replay] ${rows.length} records from ${FROM} -> ${TO}`)
  let prev = rows[0]?.t ?? 0
  for (const r of rows) {
    const gap = r.t - prev
    prev = r.t
    const wait = Math.min(gap, MAX_GAP)
    if (wait > 0) await sleep(wait / SPEED)
    const dest = join(TO, r.rel)
    mkdirSync(dirname(dest), { recursive: true })
    appendFileSync(dest, r.line + '\n')
    if (gap >= 5000) console.log(`[replay] after a ${Math.round(gap / 1000)} s pause: ${r.rel}`)
  }
  console.log('[replay] done')
}

do { await once(); if (LOOP) await sleep(15000) } while (LOOP)
