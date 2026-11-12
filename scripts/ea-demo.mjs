#!/usr/bin/env node
/**
 * ea-demo.mjs — plays a fixture EA session into a projects dir on its own
 * clock, so the office's EA scenes (server/ea-scenes.js) can be seen and
 * checked without MT5: a .set read, a lot-sizing edit (risk badge, MetaEditor
 * and DAX screens), a compile with 2 errors (red), a clean one (green), a
 * tick-data pull for 2019-2023 (cabinets), then a tester run whose report
 * file is written the moment its tool result lands. Every number on screen
 * comes from that fixture report (tests/fixtures/ea/make-ea-fixtures.mjs:
 * "SchoolRun_FIXTURE", a seeded random walk — not a real test).
 *
 *   node scripts/ea-demo.mjs [--to <projects dir>] [--root <EA folder>] [--speed 1] [--no-report] [--with-fixtures] [--hold-tester <s>]
 *
 * --hold-tester keeps the tester "running" that many seconds longer.
 *
 * --with-fixtures also plays tests/fixtures/transcripts (two more sessions)
 * on the same clock, for the Command Centre. Then point the watcher at the
 * projects dir: node scripts/transcript-watch.mjs --dir <dir> --all-projects
 */
import { mkdirSync, appendFileSync, writeFileSync, rmSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, dirname, relative } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'
import { eaSessionRecords } from '../tests/fixtures/ea/make-ea-fixtures.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const HOME = process.env.AGENT_OFFICE_HOME || join(homedir(), '.agent-office')
const TO = value('--to', join(HOME, 'ea-demo-projects'))
const EA_ROOT = value('--root', join(HOME, 'ea-demo', 'EA Development'))
const SPEED = Number(value('--speed', '1')) || 1
const enc = p => p.replace(/[^A-Za-z0-9]/g, '-')
const sleep = ms => new Promise(r => setTimeout(r, ms))

rmSync(TO, { recursive: true, force: true })
mkdirSync(TO, { recursive: true })
rmSync(EA_ROOT, { recursive: true, force: true })

const { records, setup, files, testerDoneAt } = eaSessionRecords(EA_ROOT, { reportWritten: !args.includes('--no-report') })
const HOLD = Number(value('--hold-tester', '0')) || 0
for (const r of records) if (r.at >= testerDoneAt) r.at += HOLD
for (const f of setup) { mkdirSync(dirname(f.path), { recursive: true }); writeFileSync(f.path, f.data) }
const sessionId = records[0].record.sessionId
const plays = records.map(r => ({ at: r.at, file: join(TO, enc(files.ea), `${sessionId}.jsonl`), record: r.record, writes: r.writes }))

if (args.includes('--with-fixtures')) {
  const from = join(ROOT, 'tests', 'fixtures', 'transcripts')
  const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : n.endsWith('.jsonl') ? [p] : [] })
  const rows = []
  for (const file of walk(from)) {
    readFileSync(file, 'utf8').split('\n').filter(Boolean).forEach(line => {
      const record = JSON.parse(line)
      rows.push({ file: join(TO, relative(from, file)), record, t: Date.parse(record.timestamp) })
    })
  }
  const t0 = Math.min(...rows.filter(r => Number.isFinite(r.t)).map(r => r.t))
  for (const r of rows) plays.push({ at: Number.isFinite(r.t) ? (r.t - t0) / 1000 : 0, file: r.file, record: r.record })
}
plays.sort((a, b) => a.at - b.at)

console.log(`[ea-demo] ${plays.length} records -> ${TO} (EA folder ${EA_ROOT})`)
const start = Date.now()
for (const p of plays) {
  const due = start + (p.at * 1000) / SPEED
  if (due > Date.now()) await sleep(due - Date.now())
  for (const w of p.writes ?? []) { mkdirSync(dirname(w.path), { recursive: true }); writeFileSync(w.path, w.data) }
  const record = p.record.type === 'summary' ? p.record : { ...p.record, timestamp: new Date().toISOString() }
  mkdirSync(dirname(p.file), { recursive: true })
  appendFileSync(p.file, JSON.stringify(record) + '\n')
  if (p.writes?.length) console.log(`[ea-demo] t=${p.at}s wrote ${p.writes.map(w => w.path.split(/[\\/]/).pop()).join(', ')}`)
}
console.log('[ea-demo] done')
