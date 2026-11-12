/**
 * ea-workbench.js — what Jake's EA Workbench run queue is doing, read-only,
 * for the backtest station (server/ea-scenes.js).
 *
 * Most of Jake's MT5 tester runs are not started by a Claude tool call: Claude
 * queues them with `runqueue.py add` and the Workbench's runner (a scheduled
 * task, every minute) launches them on a free tester. So the station reads the
 * queue's own files, the way `runqueue.py status` does:
 *
 *   <EAWorkbench>\runqueue\queue.json    {items: [{id, test, install, campaign, what, expert, symbol,
 *                                          status: queued|starting|started|dropped|failed|refused, created, started}]}
 *   <EAWorkbench>\runqueue\config.json   {armed, installs: {<terminal id>: {name, exe}}}
 *   <EAWorkbench>\runqueue\state.json    {holds: {<terminal id>: {why, until}}, ...}
 *   <campaign>\pipeline_state.json        {status, updated, owner_pid, native_pid, terminal, completed, planned,
 *                                          completed_cases[], run}
 *   <campaign>\progress.json              {run, completed_cases, planned, updated}
 *
 * A started item stays "started" in the queue for ever; whether it still runs
 * is its campaign's pipeline state: not finished (runqueue.py's FINISHED words)
 * and its owner or tester process alive. A finished case's tester report is
 * <APPDATA>\MetaQuotes\Terminal\<terminal id>\<case>.htm (Report= is the case
 * name). Numbers only ever come from that report; an optimisation's XML has no
 * single result, and then the card says so.
 *
 * Nothing here writes a file, starts or stops anything.
 */

import { existsSync, readFileSync, statSync } from 'fs'
import path from 'path'

/** runqueue.py's FINISHED: a pipeline status with any of these words has ended */
export const FINISHED = /COMPLETE|REVIEW|FAIL|STOP|PAUS|INVALID|ABORT|CLOSED|ERROR|HALT|BLOCKED|DONE/i
const OPEN = new Set(['queued', 'starting'])
/** How many of the newest started items are looked at (their campaigns read) */
const RECENT_STARTED = 24
const MAX_JSON_BYTES = 8 * 1024 * 1024

const isWin = p => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')
const join = (a, ...b) => (isWin(a) ? path.win32.join(a, ...b) : path.posix.join(a, ...b))
const base = p => String(p ?? '').split(/[\\/]/).pop() || ''

function readJson(p) {
  try {
    const st = statSync(p)
    if (!st.isFile() || st.size > MAX_JSON_BYTES) return null
    let text = readFileSync(p, 'utf8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    return JSON.parse(text)
  } catch { return null }
}

export function pidAlive(pid) {
  const n = Number(pid)
  if (!Number.isInteger(n) || n <= 0) return false
  try { process.kill(n, 0); return true } catch (e) { return e?.code === 'EPERM' }
}

/** The Workbench folder: the configured one, else %LOCALAPPDATA%\EAWorkbench when it has a run queue; null if none. */
export function findWorkbench(setting, localAppData) {
  if (setting === false) return null
  const dirs = typeof setting === 'string' && setting ? [setting] : localAppData ? [join(localAppData, 'EAWorkbench')] : []
  for (const d of dirs) if (existsSync(join(d, 'runqueue', 'queue.json'))) return d
  return null
}

/** "2026-11-12T16:49:02" (the queue's local time) or an ISO time with a zone -> ms; null if not a time. */
function when(s) {
  if (typeof s !== 'string' || !s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

const shortWhat = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 90)

/**
 * The run queue now.
 * @param {string} dir the EAWorkbench folder
 * @param {{ alive?: (pid: number) => boolean, readReport?: (p: string) => object | null, appData?: string | null, now?: number }} [o]
 */
export function readWorkbench(dir, { alive = pidAlive, readReport = () => null, appData = null, now = Date.now() } = {}) {
  const rq = join(dir, 'runqueue')
  const queue = readJson(join(rq, 'queue.json'))
  if (!queue || !Array.isArray(queue.items)) return { ok: false, why: 'queue.json not readable', at: now }
  const cfg = readJson(join(rq, 'config.json')) ?? {}
  const state = readJson(join(rq, 'state.json')) ?? {}
  const installs = cfg.installs && typeof cfg.installs === 'object' ? cfg.installs : {}
  const nameOf = id => installs[id]?.name || (id ? String(id).slice(0, 6) : '?')
  const items = queue.items.filter(x => x && typeof x === 'object')

  const queued = items.filter(x => OPEN.has(x.status))
  const started = items.filter(x => x.status === 'started' && x.campaign).sort((a, b) => (when(b.started) ?? 0) - (when(a.started) ?? 0)).slice(0, RECENT_STARTED)

  const runs = []
  for (const it of started) {
    const ps = readJson(join(it.campaign, 'pipeline_state.json'))
    if (!ps || typeof ps !== 'object') continue
    const pr = readJson(join(it.campaign, 'progress.json')) ?? {}
    const status = String(ps.status ?? '')
    const finished = FINISHED.test(status)
    const procAlive = alive(Number(ps.owner_pid)) || alive(Number(ps.native_pid)) || alive(Number(pr.native_pid))
    const cases = Array.isArray(ps.completed_cases) ? ps.completed_cases.map(String) : []
    runs.push({
      id: String(it.id ?? ''), test: String(it.test ?? ''), install: String(ps.terminal || it.install || '').toUpperCase(),
      what: shortWhat(it.what), campaign: base(it.campaign), campaignPath: it.campaign,
      expert: it.expert ? base(String(it.expert).replace(/\\/g, '/')).replace(/\.ex5$/i, '') : null, symbol: it.symbol ?? null,
      status, running: !finished && procAlive, finished,
      startedAt: when(it.started), updatedAt: when(ps.updated) ?? when(pr.updated),
      completed: Number.isFinite(ps.completed) ? ps.completed : cases.length, planned: Number.isFinite(ps.planned) ? ps.planned : (Number.isFinite(pr.planned) ? pr.planned : null),
      run: typeof (ps.run ?? pr.run) === 'string' ? (ps.run ?? pr.run) : null,
      lastCase: cases.length ? cases[cases.length - 1] : null,
    })
  }

  const running = runs.filter(r => r.running)
  const done = runs.filter(r => r.finished).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const holds = state.holds && typeof state.holds === 'object' ? state.holds : {}

  /** The tester report of a case on a terminal, read from its data folder; null with why. */
  const reportOf = (terminal, kase) => {
    if (!kase) return { report: null, why: 'no finished case yet' }
    if (!appData || !terminal) return { report: null, why: 'no MT5 data folder to look in' }
    const tdir = join(appData, 'MetaQuotes', 'Terminal', terminal)
    for (const ext of ['.htm', '.html', '.xml']) {
      const p = join(tdir, `${kase}${ext}`)
      if (!existsSync(p)) continue
      const r = readReport(p)
      if (r) return { report: r }
      return { report: null, why: ext === '.xml' ? `${kase}${ext} is an optimisation (no single result)` : `${kase}${ext} could not be read` }
    }
    return { report: null, why: `no report named ${kase} on ${nameOf(terminal)}` }
  }

  let latest = null
  if (done[0]) {
    const d = done[0]
    const { report, why } = reportOf(d.install, d.lastCase)
    latest = { ...d, installName: nameOf(d.install), report, ...(report ? {} : { why }) }
  }

  const perInstall = Object.keys(installs).map(id => {
    const r = running.find(x => x.install === id.toUpperCase())
    const hold = holds[id]
    return {
      id, name: nameOf(id), running: r ? { test: r.test, what: r.what, completed: r.completed, planned: r.planned, run: r.run, startedAt: r.startedAt } : null,
      queued: queued.filter(q => String(q.install ?? '').toUpperCase() === id.toUpperCase()).length,
      held: hold && typeof hold === 'object' && (!hold.until || (when(hold.until) ?? Infinity) > now) ? String(hold.why ?? 'held').slice(0, 80) : null,
    }
  })

  return {
    ok: true, at: now, armed: cfg.armed === true,
    running: running.map(r => ({ ...r, installName: nameOf(r.install) })),
    queued: queued.length,
    installs: perInstall,
    latest,
    /** The newest started run (what is being worked on), for the equity wall's focus */
    newest: started[0] ? { test: String(started[0].test ?? ''), expert: started[0].expert ? base(String(started[0].expert).replace(/\\/g, '/')).replace(/\.ex5$/i, '') : null, startedAt: when(started[0].started) } : null,
  }
}
