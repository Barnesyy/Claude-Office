#!/usr/bin/env node
/**
 * replay-tail.mjs — replays the last stretch of a real ~/.claude snapshot as
 * if it were happening now, to check the transcript watcher against real
 * sessions (start-up catch-up first, then live growth).
 *
 *   node scripts/replay-tail.mjs --from <snapshot .claude dir> --to <scratch .claude dir>
 *        [--at <ISO time to cut at>] [--live-minutes 10] [--speed 1] [--max-gap-ms 20000] [--stage-only]
 *
 * Everything up to the cut is written at once, with each record's timestamp
 * and each file's mtime moved forward so the cut lands on "now" (so start-up
 * sees the sessions that were live then as live). The records after the cut
 * are then appended on their own (shifted) clock, any one gap capped at
 * --max-gap-ms, faster with --speed. sessions/*.json are copied as they are
 * (point the watcher at it with --registry-any-pid). Only `timestamp` fields
 * change; the snapshot is never written.
 */
import { readdirSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, rmSync, statSync, utimesSync, copyFileSync, existsSync } from 'fs'
import { join, dirname, relative } from 'path'

const args = process.argv.slice(2)
const value = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const FROM = value('--from'); const TO = value('--to')
if (!FROM || !TO) { console.error('usage: replay-tail.mjs --from <snapshot .claude> --to <scratch .claude> [--at ISO] [--live-minutes 10]'); process.exit(2) }
const SPEED = Number(value('--speed', '1')) || 1
const MAX_GAP = Number(value('--max-gap-ms', '20000')) || 20000

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

const files = walk(join(FROM, 'projects')).map(file => {
  let t = -Infinity
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line, i) => {
    let r = null
    try { r = JSON.parse(line) } catch {}
    const rt = Date.parse(r?.timestamp)
    if (Number.isFinite(rt)) t = rt
    return { r, line, i, t, timed: Number.isFinite(rt) }
  })
  return { file, rel: relative(FROM, file), rows, mtime: statSync(file).mtimeMs }
})
const newest = Math.max(...files.flatMap(f => f.rows.map(r => r.t)).filter(Number.isFinite))
const at = value('--at') ? Date.parse(value('--at')) : newest - Number(value('--live-minutes', '10')) * 60_000
const shift = Date.now() - at
const shifted = row => {
  if (!row.r || !row.timed) return row.line
  return JSON.stringify({ ...row.r, timestamp: new Date(Date.parse(row.r.timestamp) + shift).toISOString() })
}

rmSync(TO, { recursive: true, force: true })
mkdirSync(join(TO, 'projects'), { recursive: true })
if (existsSync(join(FROM, 'sessions'))) {
  mkdirSync(join(TO, 'sessions'), { recursive: true })
  for (const n of readdirSync(join(FROM, 'sessions')).filter(n => n.endsWith('.json'))) copyFileSync(join(FROM, 'sessions', n), join(TO, 'sessions', n))
}
const later = []
for (const f of files) {
  const dest = join(TO, f.rel)
  mkdirSync(dirname(dest), { recursive: true })
  const head = f.rows.filter(r => r.t <= at)
  writeFileSync(dest, head.map(shifted).join('\n') + (head.length ? '\n' : ''))
  // mtime: the last write before the cut (or the file's own, when it was only touched), moved to "now"
  const lastHead = head.length ? head[head.length - 1].t : -Infinity
  const m = Number.isFinite(lastHead) ? Math.max(lastHead, Math.min(f.mtime, at)) : Math.min(f.mtime, at)
  const mt = new Date(m + shift)
  utimesSync(dest, mt, mt)
  for (const r of f.rows.filter(r => r.t > at)) later.push({ ...r, dest })
}
later.sort((a, b) => a.t - b.t || (a.dest === b.dest ? a.i - b.i : 0))
console.log(`[replay-tail] cut at ${new Date(at).toISOString()}: ${files.length} files staged, ${later.length} records to play`)
if (args.includes('--stage-only')) process.exit(0)
const sleep = ms => new Promise(r => setTimeout(r, ms))
let prev = at
for (const r of later) {
  const gap = r.t - prev
  prev = r.t
  const wait = Math.min(gap, MAX_GAP) / SPEED
  if (wait > 0) await sleep(wait)
  appendFileSync(r.dest, shifted(r) + '\n')
}
console.log('[replay-tail] done')
