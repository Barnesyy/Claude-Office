/**
 * progression.js — XP, office levels, the trophy shelf, milestones,
 * unlockable furniture, the lessons binder, the daily recap and the
 * quarterly review. Kept in chat.db beside the recap (server/recap.js).
 *
 * ## Where the activity comes from
 *
 *   noteBroadcast(payload)  every payload the office broadcasts (server/event-taps.js):
 *                           session_turn_end (a finished turn), agent_completed (a
 *                           worker finished), signal (test_ok / build_ok / push_done /
 *                           deploy_success from the Python tracker; failures noted, 0 XP)
 *   noteFact(fact)          what the transcript watcher read from a tool call
 *                           (server/progression-facts.js, POST /progression/facts):
 *                           commit, push, pr_merge, mt5_run (walk-forward, report),
 *                           ea_compile, test/build (JS converter only), lesson
 *   noteEquity(readings)    equity from a real MT5 account report
 *                           (server/progression-equity.js); nothing else sets it
 *   noteResult(result)      a finished tester run's report numbers (server/ea-scenes.js)
 *
 * ## The firm's money
 *
 *   Every counted event pays cash in step with its XP (CASH_BASE), a tester
 *   result that beats the best on the books pays a breakthrough bonus, and a
 *   new account equity high pays a share of the real profit (PROFIT_SHARE).
 *   buy(id) spends it on a piece for the office; nothing unbought is drawn.
 *
 * ## Anti-farming
 *
 *   - failures never earn XP (they are counted for the recap and for lessons)
 *   - a replayed event (same tool_use_id, agent id, session+prompt) counts once (progression_seen)
 *   - the same thing again within REPEAT_MS (same session, kind and label) counts nothing
 *   - diminishing returns: the nth XP event of a kind in a day earns base / (1 + 0.35 n),
 *     and each kind stops earning at DAILY_CAP_FACTOR x its base for the day
 *   - trophies count events, so a repeat that earned nothing still counts once (cooldown
 *     repeats do not count at all)
 *
 * ## Broadcasts
 *
 *   progression_update  { xp, level, title, levelFloor, nextLevelXp, todayXp, streak, gain }
 *   progression_award   { award: { id, type: 'level' | 'trophy' | 'milestone' | 'unlock', title, tier?, detail?, rare?, at } }
 *   progression_reset   {}   progression_settings { enabled }
 */

import { localDate } from './recap.js'
import { FACT_KINDS } from './progression-facts.js'

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

/** Base XP per kind of event. Failures are not here: they earn nothing. */
export const XP_BASE = {
  turn: 10,
  worker: 15,
  test_ok: 12,
  build_ok: 8,
  ea_compile: 10,
  commit: 15,
  push: 20,
  pr_merge: 60,
  deploy: 40,
  mt5_run: 25,
  mt5_report: 10,
  walk_forward: 60,
  lesson: 30,
  equity_high: 80,
}

export const DAILY_CAP_FACTOR = 8
export const REPEAT_MS = 90_000
const DECAY = 0.35

/** XP for the nth (0-based) event of a kind today, given what that kind already earned today. */
export function xpFor(kind, n, earnedToday = 0) {
  const base = XP_BASE[kind] ?? 0
  if (!base) return 0
  const cap = base * DAILY_CAP_FACTOR
  const raw = Math.max(1, Math.round(base / (1 + DECAY * n)))
  return Math.max(0, Math.min(raw, cap - earnedToday))
}

/** Total XP needed to reach a level (level 1 is 0). */
export function levelFloor(level) {
  return level <= 1 ? 0 : Math.round(150 * Math.pow(level - 1, 1.6))
}

export function levelOf(xp) {
  let l = 1
  while (levelFloor(l + 1) <= xp && l < 99) l++
  return l
}

const TITLES = [
  [1, 'Back Office'], [2, 'Junior Desk'], [3, 'Trading Desk'], [5, 'Prop Desk'], [8, 'Trading Floor'],
  [12, 'Hedge Fund'], [16, 'Market Maker'], [20, 'Corner Office'], [25, 'Exchange Floor'],
]
export function levelTitle(level) {
  let t = TITLES[0][1]
  for (const [l, name] of TITLES) if (level >= l) t = name
  return t
}

export const TIERS = ['bronze', 'silver', 'gold', 'platinum']

/** Trophy tracks: lifetime counts of one kind, four tiers each. */
export const TRACKS = [
  { id: 'turns', kind: 'turn', title: 'Turns finished', tiers: [25, 250, 1000, 5000] },
  { id: 'workers', kind: 'worker', title: 'Workers clocked out', tiers: [10, 100, 500, 2000] },
  { id: 'greens', kind: 'test_ok', title: 'Green test runs', tiers: [10, 100, 500, 2000] },
  { id: 'builds', kind: 'build_ok', title: 'Clean builds', tiers: [10, 100, 500, 2000] },
  { id: 'compiles', kind: 'ea_compile', title: 'EA compiles, 0 errors', tiers: [5, 50, 250, 1000] },
  { id: 'commits', kind: 'commit', title: 'Commits', tiers: [10, 100, 500, 2000] },
  { id: 'pushes', kind: 'push', title: 'Pushes', tiers: [5, 50, 250, 1000] },
  { id: 'prs', kind: 'pr_merge', title: 'PRs merged', tiers: [1, 10, 50, 200] },
  { id: 'backtests', kind: 'mt5_run', title: 'MT5 tester runs', tiers: [1, 25, 100, 500] },
  { id: 'reports', kind: 'mt5_report', title: 'Tester reports filed', tiers: [1, 25, 100, 500] },
  { id: 'walkforward', kind: 'walk_forward', title: 'Walk-forward runs', tiers: [1, 10, 50, 200] },
  { id: 'lessons', kind: 'lesson', title: 'Lessons learned', tiers: [1, 10, 50, 200] },
  { id: 'equity', kind: 'equity_high', title: 'New demo equity highs', tiers: [1, 5, 25, 100] },
]

/** One-off milestones. `test` reads the context built in check(). */
export const MILESTONES = [
  { id: 'first-turn', title: 'Open for business', detail: 'The first finished turn', test: c => c.counts.turn >= 1 },
  { id: 'first-worker', title: 'First hire', detail: 'A worker clocked out', test: c => c.counts.worker >= 1 },
  { id: 'first-pr', title: 'First parcel shipped', detail: 'A pull request merged', test: c => c.counts.pr_merge >= 1 },
  { id: 'first-backtest', title: 'Real ticks, real run', detail: 'An MT5 tester run finished', test: c => c.counts.mt5_run >= 1 },
  { id: 'first-walkforward', title: 'Out of sample', detail: 'A walk-forward run finished', test: c => c.counts.walk_forward >= 1 },
  { id: 'first-lesson', title: 'Learned the hard way', detail: 'Something failed, then worked', test: c => c.counts.lesson >= 1 },
  { id: 'green-day', title: 'Green day', detail: '5 green test runs and no failed ones in a day', test: c => c.today.test_ok >= 5 && c.today.test_fail === 0 },
  { id: 'streak-3', title: 'Three in a row', detail: 'Active 3 days running', test: c => c.streak >= 3 },
  { id: 'streak-7', title: 'Full week', detail: 'Active 7 days running', test: c => c.streak >= 7 },
  { id: 'streak-30', title: 'Month on the desk', detail: 'Active 30 days running', test: c => c.streak >= 30 },
  { id: 'level-5', title: 'Prop Desk', detail: 'Office level 5', test: c => c.level >= 5 },
  { id: 'level-10', title: 'Double digits', detail: 'Office level 10', test: c => c.level >= 10 },
  { id: 'level-20', title: 'Corner Office', detail: 'Office level 20', test: c => c.level >= 20 },
]

/**
 * Furniture that unlocks. A locked one stands under a dust sheet with a lock
 * (rare ones stay hidden until they unlock).
 */
/**
 * The firm's money. Every counted event pays cash in step with its XP (so the
 * same diminishing returns and daily caps apply), a research result that beats
 * the best one on the books pays a breakthrough bonus, and a new equity high
 * on a real account report pays a share of the profit.
 */
export const CASH_BASE = {
  turn: 5,
  worker: 10,
  test_ok: 10,
  build_ok: 5,
  ea_compile: 15,
  commit: 20,
  push: 20,
  pr_merge: 150,
  deploy: 100,
  mt5_run: 60,
  mt5_report: 30,
  walk_forward: 250,
  lesson: 80,
}
/** Cash for an event that earned `xp` of its kind's base XP. */
export function cashFor(kind, xp) {
  const base = XP_BASE[kind]
  const pay = CASH_BASE[kind]
  return base && pay && xp > 0 ? Math.max(1, Math.round((pay * xp) / base)) : 0
}
/** The firm's cut of new profit above an account's high-water mark */
export const PROFIT_SHARE = { demo: 0.1, live: 0.5 }
/** A breakthrough: a tester result whose net profit / max drawdown beats the best for that EA, symbol and period */
/**
 * Which line of the books a payment belongs on.
 * @param {string} kind the ledger kind
 * @param {string | null} [label] the ledger label ("live account profit")
 * @returns {'work' | 'breakthrough' | 'demo' | 'live' | 'spent'}
 */
export function cashSource(kind, label) {
  if (kind === 'purchase') return 'spent'
  if (kind === 'breakthrough') return 'breakthrough'
  if (kind === 'ea_profit') return String(label ?? '').startsWith('live') ? 'live' : 'demo'
  return 'work'
}

export const BREAKTHROUGH = { bonus: 400, minTrades: 30, margin: 1.02, paidPerDay: 3 }

/**
 * What the firm can buy for the office (`price`), and the rare pieces that are
 * earned (`test`). Nothing bought is drawn: the office starts bare.
 */
export const UNLOCKS = [
  { id: 'trophy-cabinet', title: 'Trophy cabinet', detail: 'Where the trophies go, with the level plate', category: 'Furniture', price: 250 },
  { id: 'mailbox', title: 'Mailbox', detail: 'Its flag goes up when there is news', category: 'Furniture', price: 400 },
  { id: 'lessons-binder', title: 'Lessons binder', detail: 'Every fail-then-fix, filed', category: 'Furniture', price: 600 },
  { id: 'shipped-bin', title: 'Shipped bin', detail: 'A parcel per merged PR or deploy', category: 'Furniture', price: 900 },
  { id: 'backtest-bay', title: 'Backtest bay', detail: 'A crash cart at the rack, with the run count', category: 'Equipment', price: 1500 },
  { id: 'equity-wall', title: 'Equity plate', detail: 'The demo equity high, in brass under the wall dashboard', category: 'Equipment', price: 2000 },
  { id: 'rooftop-garden', title: 'Window garden', detail: 'A plant for every merged PR', category: 'Decor', price: 2500 },
  { id: 'money-tree', title: 'Money tree', detail: 'It does not grow money. It looks like it might', category: 'Decor', price: 5000 },
  // Props the office already had art for, now things to buy
  { id: 'trader-bear', title: 'Trader bear', detail: 'Sits on the filing cabinet in a pinstripe jacket', category: 'Decor', price: 350 },
  { id: 'candle-mug', title: 'Candle mug', detail: 'A candlestick mug on the lounge table', category: 'Decor', price: 200 },
  { id: 'stop-loss-sign', title: 'Stop-loss sign', detail: 'Stands by the backtest rack, in case anyone forgets', category: 'Decor', price: 500 },
  { id: 'office-plants', title: 'Office plants', detail: 'Two more plants on the floor', category: 'Decor', price: 800 },
  { id: 'air-con', title: 'Air conditioning', detail: 'A wall unit over the water cooler', category: 'Equipment', price: 1800 },
  // More office space: each is a room (`room`) that does not exist until it is bought
  { id: 'room-lunch', title: 'Lunch room', detail: 'A kitchen and cafe tables for breaks and long idles', category: 'Office space', price: 3000, room: 'lunch-room' },
  { id: 'room-meeting', title: 'Meeting room', detail: 'Where a session and its workers gather', category: 'Office space', price: 4500, room: 'meeting-room' },
  { id: 'room-server', title: 'Server room', detail: 'Racks for the MCP servers and their workers', category: 'Office space', price: 6000, room: 'server-room' },
  // Rare
  { id: 'golden-bull', title: 'Golden bull', detail: '10 walk-forward runs', hint: 'Rare', rare: true, test: c => c.counts.walk_forward >= 10 },
  { id: 'clover', title: 'Four-leaf clover', detail: 'Fixed something that had failed 5 times or more', hint: 'Rare', rare: true, test: c => c.lessonMaxFails >= 5 },
  { id: 'crown', title: 'Crown', detail: 'Office level 20', hint: 'Rare', rare: true, test: c => c.level >= 20 },
  { id: 'gem', title: 'Desk gem', detail: 'Active 30 days running', hint: 'Rare', rare: true, test: c => c.streak >= 30 },
]

const COUNT_KINDS = [...Object.keys(XP_BASE), 'breakthrough', 'test_fail', 'build_fail', 'deploy_fail', 'worker_fail', 'ea_compile_fail', 'repeat']

// Why 30: seen keys only guard against replays; the watcher replays at most a turn
const KEEP_SEEN_DAYS = 30
const MAX_LOG = 300
const MAX_LESSONS = 500
const MAX_PLANTS = 200

// A worker whose result says it did not finish its job earns nothing
// (the server's own prefixes: "failed: ...", "stopped", "session ended", "went quiet, ...")
const WORKER_FAILED = /^\s*(failed|error|stopped|interrupted|session ended|went quiet)\b/i

const SIGNAL_GAIN = { test_ok: 'test_ok', build_ok: 'build_ok', push_done: 'push', deploy_success: 'deploy' }
const SIGNAL_FAIL = { test_failed: 'test_fail', build_failed: 'build_fail', deploy_fail: 'deploy_fail' }
const SIGNAL_TOPIC = { test_ok: 'tests', test_failed: 'tests', build_ok: 'build', build_failed: 'build', deploy_success: 'deploy', deploy_fail: 'deploy' }

/** "2026-Q4" for a local date */
export function quarterOf(date) {
  const [y, m] = date.split('-').map(Number)
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
}

export function isQuarter(q) {
  return typeof q === 'string' && /^\d{4}-Q[1-4]$/.test(q)
}

function quarterRange(q) {
  const y = Number(q.slice(0, 4))
  const n = Number(q.slice(-1))
  const from = `${y}-${String((n - 1) * 3 + 1).padStart(2, '0')}-01`
  const end = new Date(y, n * 3, 0) // last day of the quarter's last month
  return { from, to: localDate(end.getTime()) }
}

function dayBefore(date, n = 1) {
  const [y, m, d] = date.split('-').map(Number)
  return localDate(new Date(y, m - 1, d - n, 12).getTime())
}

/** A stable small number from a string (a plant's look). */
export function seedOf(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

const clean = (s, n = 60) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : undefined)

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ now?: () => number, broadcast?: (payload: object) => void, log?: Console }} [opts]
 */
/** How long a signal-paired lesson waits for the watcher's own facts before it counts (the watcher posts its facts just after the events) */
export const SIGNAL_LESSON_WAIT_MS = 5000

const deferUnref = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.() }

export function createProgression(db, { now = () => Date.now(), broadcast = () => {}, log = console, defer = deferUnref } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS progression_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS progression_daily (date TEXT NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, xp INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (date, kind)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS progression_counts (kind TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS progression_seen (kind TEXT NOT NULL, key TEXT NOT NULL, date TEXT NOT NULL, PRIMARY KEY (kind, key)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS progression_awards (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, tier TEXT, detail TEXT, rare INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, date TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS progression_lessons (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, fails INTEGER NOT NULL, ms INTEGER NOT NULL, session TEXT, at INTEGER NOT NULL, date TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS progression_garden (key TEXT PRIMARY KEY, repo TEXT, pr INTEGER, seed INTEGER NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS progression_cashflow (date TEXT NOT NULL, source TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (date, source)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS progression_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL, label TEXT);
    CREATE TABLE IF NOT EXISTS progression_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, xp INTEGER NOT NULL, label TEXT);
  `)

  const q = {
    getState: db.prepare('SELECT value FROM progression_state WHERE key = ?'),
    setState: db.prepare('INSERT INTO progression_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    daily: db.prepare('SELECT count, xp FROM progression_daily WHERE date = ? AND kind = ?'),
    bumpDaily: db.prepare('INSERT INTO progression_daily (date, kind, count, xp) VALUES (?, ?, 1, ?) ON CONFLICT(date, kind) DO UPDATE SET count = count + 1, xp = xp + excluded.xp'),
    dayRows: db.prepare('SELECT kind, count, xp FROM progression_daily WHERE date = ?'),
    rangeRows: db.prepare('SELECT date, kind, count, xp FROM progression_daily WHERE date >= ? AND date <= ?'),
    activeDays: db.prepare('SELECT date FROM progression_daily WHERE xp > 0 GROUP BY date ORDER BY date DESC LIMIT 400'),
    counts: db.prepare('SELECT kind, count FROM progression_counts'),
    bumpCount: db.prepare('INSERT INTO progression_counts (kind, count) VALUES (?, 1) ON CONFLICT(kind) DO UPDATE SET count = count + 1'),
    seen: db.prepare('INSERT OR IGNORE INTO progression_seen (kind, key, date) VALUES (?, ?, ?)'),
    pruneSeen: db.prepare('DELETE FROM progression_seen WHERE date < ?'),
    awards: db.prepare('SELECT * FROM progression_awards ORDER BY at, id'),
    awardsRange: db.prepare('SELECT * FROM progression_awards WHERE date >= ? AND date <= ? ORDER BY at, id'),
    addAward: db.prepare('INSERT OR IGNORE INTO progression_awards (id, type, title, tier, detail, rare, at, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    addLesson: db.prepare('INSERT INTO progression_lessons (label, fails, ms, session, at, date) VALUES (?, ?, ?, ?, ?, ?)'),
    lessons: db.prepare('SELECT id, label, fails, ms, at, date FROM progression_lessons ORDER BY id DESC LIMIT ?'),
    lessonsRange: db.prepare('SELECT id, label, fails, ms, at, date FROM progression_lessons WHERE date >= ? AND date <= ? ORDER BY id DESC'),
    pruneLessons: db.prepare('DELETE FROM progression_lessons WHERE id <= (SELECT id FROM progression_lessons ORDER BY id DESC LIMIT 1 OFFSET ?)'),
    maxFails: db.prepare('SELECT COALESCE(MAX(fails), 0) AS m FROM progression_lessons'),
    plant: db.prepare('INSERT OR IGNORE INTO progression_garden (key, repo, pr, seed, at) VALUES (?, ?, ?, ?, ?)'),
    plants: db.prepare('SELECT key, repo, pr, seed, at FROM progression_garden ORDER BY at DESC, key LIMIT ?'),
    plantCount: db.prepare('SELECT COUNT(*) AS n FROM progression_garden'),
    prunePlants: db.prepare('DELETE FROM progression_garden WHERE key IN (SELECT key FROM progression_garden ORDER BY at DESC LIMIT -1 OFFSET ?)'),
    log: db.prepare('INSERT INTO progression_log (at, date, kind, xp, label) VALUES (?, ?, ?, ?, ?)'),
    recent: db.prepare('SELECT at, kind, xp, label FROM progression_log ORDER BY id DESC LIMIT ?'),
    ledger: db.prepare('INSERT INTO progression_ledger (at, date, kind, amount, label) VALUES (?, ?, ?, ?, ?)'),
    flow: db.prepare('INSERT INTO progression_cashflow (date, source, amount) VALUES (?, ?, ?) ON CONFLICT(date, source) DO UPDATE SET amount = amount + excluded.amount'),
    flowAll: db.prepare('SELECT date, source, amount FROM progression_cashflow ORDER BY date'),
    flowCount: db.prepare('SELECT COUNT(*) AS n FROM progression_cashflow'),
    ledgerAll: db.prepare('SELECT date, kind, amount, label FROM progression_ledger ORDER BY id'),
    ledgerRecent: db.prepare('SELECT at, kind, amount, label FROM progression_ledger ORDER BY id DESC LIMIT ?'),
    ledgerDay: db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM progression_ledger WHERE date = ? AND amount > 0'),
    ledgerDayKind: db.prepare('SELECT COUNT(*) AS n FROM progression_ledger WHERE date = ? AND kind = ? AND amount > 0'),
    pruneLedger: db.prepare('DELETE FROM progression_ledger WHERE id <= (SELECT id FROM progression_ledger ORDER BY id DESC LIMIT 1 OFFSET ?)'),
    pruneLog: db.prepare('DELETE FROM progression_log WHERE id <= (SELECT id FROM progression_log ORDER BY id DESC LIMIT 1 OFFSET ?)'),
  }

  const state = (key, fallback) => { const r = q.getState.get(key); return r ? JSON.parse(r.value) : fallback }
  const setState = (key, value) => q.setState.run(key, JSON.stringify(value))

  /** Last time a (session, kind, label) earned, for REPEAT_MS. In memory: a restart forgets it, which only errs towards counting. */
  const lastBy = new Map()
  /** When the watcher last sent facts: while it does, its lessons are the lessons (signals' pairing stands down) */
  let factsAt = 0
  /** Signal-based lesson pairing for the hooks path: `${session}:${kind}:${target}` -> { fails, firstAt, label } */
  const signalFails = new Map()
  let prunedFor = ''

  function enabled() { return state('enabled', true) === true }

  function counts() {
    const c = Object.fromEntries(COUNT_KINDS.map(k => [k, 0]))
    for (const r of q.counts.all()) c[r.kind] = r.count
    return c
  }

  function dayKinds(date) {
    const out = Object.fromEntries(COUNT_KINDS.map(k => [k, 0]))
    const xp = Object.fromEntries(COUNT_KINDS.map(k => [k, 0]))
    for (const r of q.dayRows.all(date)) { out[r.kind] = r.count; xp[r.kind] = r.xp }
    return { counts: out, xp }
  }

  function streak(today) {
    const days = new Set(q.activeDays.all().map(r => r.date))
    let d = days.has(today) ? today : dayBefore(today)
    let n = 0
    while (days.has(d)) { n++; d = dayBefore(d) }
    return n
  }

  function totals() {
    const xp = state('xp', 0)
    const level = levelOf(xp)
    const today = localDate(now())
    const { xp: todayXp } = dayKinds(today)
    return {
      xp, level, title: levelTitle(level), levelFloor: levelFloor(level), nextLevelXp: levelFloor(level + 1),
      todayXp: Object.values(todayXp).reduce((a, b) => a + b, 0), streak: streak(today),
      cash: state('cash', 0), cashEarned: state('cashEarned', 0), todayCash: q.ledgerDay.get(today).n,
    }
  }

  // The books by day and source, kept for good (the ledger itself is pruned). A
  // firm that earned before this table existed gets it filled from its ledger.
  if (!q.flowCount.get().n) for (const r of q.ledgerAll.all()) q.flow.run(r.date, cashSource(r.kind, r.label), r.amount)

  /**
   * The firm's finances: where the money came from, what was spent, and the balance day by day.
   * @param {number} [days] how many days of history, ending today
   */
  function finances(days = 30) {
    const sources = { work: 0, breakthrough: 0, demo: 0, live: 0 }
    const byDay = new Map()
    let spent = 0
    for (const r of q.flowAll.all()) {
      const d = byDay.get(r.date) ?? { in: 0, out: 0 }
      if (r.source === 'spent') { spent -= r.amount; d.out -= r.amount } else { sources[r.source] = (sources[r.source] ?? 0) + r.amount; d.in += r.amount }
      byDay.set(r.date, d)
    }
    // Walk back from today's balance, so the line ends on the cash in hand
    const out = []
    let balance = state('cash', 0)
    const t = now()
    for (let i = 0; i < days; i++) {
      const date = localDate(t - i * 86_400_000)
      const d = byDay.get(date) ?? { in: 0, out: 0 }
      out.unshift({ date, in: d.in, out: d.out, balance })
      balance -= d.in - d.out
    }
    const first = [...byDay.keys()][0] ?? null
    return { sources, spent, since: first, days: first ? out.filter(d => d.date >= first) : out.slice(-1) }
  }

  /** Money in (amount > 0) or out (a purchase) of the firm's account, on the ledger. */
  function addCash(kind, amount, label) {
    const n = Math.round(amount)
    if (!n) return 0
    const t = now()
    setState('cash', state('cash', 0) + n)
    if (n > 0) setState('cashEarned', state('cashEarned', 0) + n)
    q.ledger.run(t, localDate(t), kind, n, clean(label) ?? null)
    q.flow.run(localDate(t), cashSource(kind, label), n)
    q.pruneLedger.run(MAX_LOG)
    return n
  }

  function award(a) {
    const t = now()
    const res = q.addAward.run(a.id, a.type, a.title, a.tier ?? null, a.detail ?? null, a.rare ? 1 : 0, t, localDate(t))
    if (res.changes !== 1) return null
    const out = { ...a, rare: !!a.rare, at: t }
    broadcast({ type: 'progression_award', award: out, timestamp: t })
    return out
  }

  /** Everything earned that is not on the books yet. */
  function check() {
    const c = counts()
    const xp = state('xp', 0)
    const level = levelOf(xp)
    const today = localDate(now())
    const ctx = {
      counts: c, level, streak: streak(today), today: dayKinds(today).counts,
      lessonMaxFails: q.maxFails.get().m, equityReadings: state('equityReadings', 0),
    }
    const have = new Set(q.awards.all().map(a => a.id))
    const out = []
    const give = a => { if (!have.has(a.id)) { const r = award(a); if (r) { have.add(a.id); out.push(r) } } }
    for (let l = 2; l <= level; l++) give({ id: `level:${l}`, type: 'level', title: `Level ${l}: ${levelTitle(l)}`, detail: `${levelFloor(l)} XP` })
    for (const tr of TRACKS) {
      tr.tiers.forEach((n, i) => { if (c[tr.kind] >= n) give({ id: `trophy:${tr.id}:${TIERS[i]}`, type: 'trophy', title: tr.title, tier: TIERS[i], detail: `${n} ${tr.title.toLowerCase()}` }) })
    }
    for (const m of MILESTONES) if (m.test(ctx)) give({ id: `milestone:${m.id}`, type: 'milestone', title: m.title, detail: m.detail })
    // Only the rare pieces are earned; the rest is bought (buy)
    for (const u of UNLOCKS) if (u.test && u.test(ctx)) give({ id: `unlock:${u.id}`, type: 'unlock', title: u.title, detail: u.detail, rare: !!u.rare })
    return out
  }

  /**
   * Count one event of `kind`: dedupe, cooldown, diminishing XP, then awards.
   * @returns {{ xp: number, counted: boolean }}
   */
  function gain(kind, { key, repeatKey, label } = {}) {
    if (!enabled()) return { xp: 0, counted: false }
    const t = now()
    const date = localDate(t)
    if (prunedFor !== date) { prunedFor = date; q.pruneSeen.run(dayBefore(date, KEEP_SEEN_DAYS)) }
    if (key && q.seen.run(kind, String(key).slice(0, 200), date).changes !== 1) return { xp: 0, counted: false }
    if (repeatKey) {
      const rk = `${kind}\u0000${repeatKey}`
      const last = lastBy.get(rk)
      if (last !== undefined && t - last < REPEAT_MS) {
        q.bumpDaily.run(date, 'repeat', 0)
        return { xp: 0, counted: false }
      }
      lastBy.set(rk, t)
      if (lastBy.size > 2000) lastBy.delete(lastBy.keys().next().value)
    }
    const row = q.daily.get(date, kind)
    const xp = XP_BASE[kind] ? xpFor(kind, row?.count ?? 0, row?.xp ?? 0) : 0
    const before = state('xp', 0)
    const cash = cashFor(kind, xp)
    db.transaction(() => {
      q.bumpDaily.run(date, kind, xp)
      q.bumpCount.run(kind)
      if (cash) addCash(kind, cash, label)
      if (xp) {
        setState('xp', before + xp)
        q.log.run(t, date, kind, xp, clean(label) ?? null)
        q.pruneLog.run(MAX_LOG)
      }
    })()
    if (XP_BASE[kind]) {
      broadcast({ type: 'progression_update', ...totals(), gain: { kind, xp, cash, ...(label ? { label: clean(label) } : {}) }, timestamp: t })
      check()
    }
    return { xp, cash, counted: true }
  }

  /** A failure: counted for the recap and the quarter, never any XP. */
  function fail(kind) {
    if (!enabled()) return
    const date = localDate(now())
    q.bumpDaily.run(date, kind, 0)
    q.bumpCount.run(kind)
  }

  function lesson({ label, fails = 1, ms = 0, session, id }) {
    if (!enabled()) return
    const l = clean(label) || 'something'
    const r = gain('lesson', { key: id, label: `fixed ${l}` })
    if (!r.counted) return
    const t = now()
    q.addLesson.run(l, Math.max(1, Math.min(999, Math.round(fails))), Math.max(0, Math.round(ms)), session ? String(session).slice(0, 80) : null, t, localDate(t))
    q.pruneLessons.run(MAX_LESSONS)
    check()
  }

  // -------------------------------------------------------------------------
  // Inputs
  // -------------------------------------------------------------------------

  function signalLesson(sig, ok) {
    if (now() - factsAt < 10 * 60_000) return // the watcher pairs these itself
    const topic = SIGNAL_TOPIC[sig.kind]
    if (!topic) return
    const target = clean(sig.target, 30)
    const k = `${sig.sessionId ?? ''}:${topic}:${target ?? ''}`
    const prev = signalFails.get(k)
    if (!ok) {
      signalFails.set(k, { fails: (prev?.fails ?? 0) + 1, firstAt: prev?.firstAt ?? now(), label: `${topic}${target ? ` (${target})` : ''}` })
      if (signalFails.size > 200) signalFails.delete(signalFails.keys().next().value)
    } else if (prev) {
      signalFails.delete(k)
      const at = now()
      // A watcher replaying a transcript sends the signal first and its own (better) lesson fact right after:
      // wait a moment, and stand down if any fact came in meanwhile
      defer(() => { if (factsAt < at) lesson({ label: prev.label, fails: prev.fails, ms: at - prev.firstAt, session: sig.sessionId }) }, SIGNAL_LESSON_WAIT_MS)
    }
  }

  /** The event tap: one broadcast payload. */
  function noteBroadcast(p) {
    if (!p || typeof p.type !== 'string' || p.type.startsWith('progression_')) return
    if (!enabled()) return
    // History the watcher read at start-up: it happened before the office was watching, so it earns nothing
    if (p.replayed === true) return
    switch (p.type) {
      case 'session_turn_end': {
        if (!p.sessionId) return
        const key = `${p.sessionId}:${p.promptId ?? Math.floor((p.timestamp ?? now()) / 1000)}`
        gain('turn', { key, label: clean(p.project, 40) ? `turn in ${clean(p.project, 40)}` : 'turn' })
        return
      }
      case 'agent_completed': {
        if (!p.agentId) return
        if (WORKER_FAILED.test(String(p.result ?? ''))) { fail('worker_fail'); return }
        gain('worker', { key: p.agentId, label: 'worker done' })
        return
      }
      case 'signal': {
        if (p.interrupted === true) return
        const kind = SIGNAL_GAIN[p.kind]
        if (kind) {
          const target = clean(p.target, 40)
          gain(kind, { repeatKey: `${p.sessionId ?? ''}:${target ?? ''}`, label: `${p.kind.replace('_', ' ')}${target ? ` ${target}` : ''}` })
          if (kind !== 'push') signalLesson(p, true)
          return
        }
        const f = SIGNAL_FAIL[p.kind]
        if (f) { fail(f); signalLesson(p, false) }
        return
      }
    }
  }

  /** One fact from the watcher (validated here: it came over HTTP). */
  function noteFact(f) {
    if (!f || typeof f !== 'object' || !FACT_KINDS.has(f.kind)) return false
    if (!enabled()) return true
    factsAt = now()
    const id = typeof f.id === 'string' ? f.id.slice(0, 200) : undefined
    const session = typeof f.sessionId === 'string' ? f.sessionId.slice(0, 80) : ''
    const label = clean(f.label)
    const repeatKey = `${session}:${label ?? ''}`
    switch (f.kind) {
      case 'commit': gain('commit', { key: id, label: label ?? 'commit' }); break
      case 'push': gain('push', { key: id, repeatKey, label: 'push' }); break
      case 'pr_merge': {
        const r = gain('pr_merge', { key: id, label: Number.isInteger(f.pr) ? `merged PR #${f.pr}` : 'merged a PR' })
        if (r.counted) {
          const repo = clean(f.repo, 80) ?? null
          const pk = Number.isInteger(f.pr) ? `${repo ?? ''}#${f.pr}` : `${id ?? now()}`
          q.plant.run(pk, repo, Number.isInteger(f.pr) ? f.pr : null, seedOf(pk), now())
          q.prunePlants.run(MAX_PLANTS)
        }
        break
      }
      case 'mt5_run': {
        const r = gain('mt5_run', { key: id, repeatKey, label: label ?? 'MT5 tester run' })
        if (r.counted && f.report === true) gain('mt5_report', { key: id && `${id}:report`, label: 'tester report filed' })
        if (r.counted && f.walkForward === true) gain('walk_forward', { key: id && `${id}:wf`, label: 'walk-forward run' })
        break
      }
      case 'ea_compile':
        if (f.ok === true) gain('ea_compile', { key: id, repeatKey, label: 'EA compiled, 0 errors' })
        else fail('ea_compile_fail')
        break
      case 'test':
      case 'build':
        if (f.ok === true) gain(`${f.kind}_ok`, { key: id, repeatKey, label: label ?? f.kind })
        else fail(`${f.kind}_fail`)
        break
      case 'lesson':
        lesson({ label, fails: Number(f.fails) || 1, ms: Number(f.ms) || 0, session, id })
        break
    }
    return true
  }

  /**
   * Demo equity readings from real MT5 reports (newest first). The first
   * reading is the baseline; a later reading above the high is a new high.
   */
  function noteEquity(readings) {
    if (!enabled() || !Array.isArray(readings) || !readings.length) return null
    // The newest reading of each account (a demo and a live account keep separate high-water marks)
    const done = new Set()
    let first
    for (const r of readings) {
      if (!Number.isFinite(r?.equity)) continue
      const acct = String(r.login ?? '')
      if (done.has(acct)) continue
      done.add(acct)
      const res = noteAccount(r, acct)
      if (first === undefined) first = res
    }
    return first ?? null
  }

  function noteAccount(r, acct) {
    const seenKey = `${r.login ?? ''}:${r.equity}:${r.mtimeMs ?? ''}`
    const lasts = state('equityLasts', {})
    if (lasts[acct] === seenKey || state('equityLast', '') === seenKey) return null
    lasts[acct] = seenKey
    setState('equityLasts', lasts)
    setState('equityLast', seenKey)
    setState('equityReadings', state('equityReadings', 0) + 1)
    const highs = state('equityHighs', {})
    // Books from before accounts were kept apart: the one high belongs to its login
    const legacy = state('equityHigh', null)
    if (legacy && !Object.keys(highs).length) highs[String(legacy.login ?? '')] = legacy
    const high = highs[acct] ?? null
    const t = now()
    const mark = { equity: r.equity, login: r.login ?? null, at: t, date: r.date ?? null, live: !!r.live }
    if (high === null) {
      highs[acct] = mark
      setState('equityHighs', highs)
      setState('equityHigh', mark)
      check()
      broadcast({ type: 'progression_update', ...totals(), timestamp: t })
      return { baseline: true, equity: r.equity }
    }
    if (r.equity > high.equity + 0.005) {
      highs[acct] = mark
      setState('equityHighs', highs)
      setState('equityHigh', mark)
      const kind = r.live ? 'live' : 'demo'
      const g = gain('equity_high', { key: seenKey, label: `${kind} equity high ${r.equity.toFixed(2)}` })
      // The firm's cut of the new profit above the old high (real money on the report, not a made-up number)
      let share = 0
      if (g.counted) {
        share = addCash('ea_profit', (r.equity - high.equity) * (r.live ? PROFIT_SHARE.live : PROFIT_SHARE.demo), `${kind} account profit`)
        if (share) broadcast({ type: 'progression_update', ...totals(), gain: { kind: 'ea_profit', xp: 0, cash: share, label: `${kind} account profit` }, timestamp: t })
      }
      return { high: true, equity: r.equity, share }
    }
    return { equity: r.equity }
  }

  /**
   * A finished tester run with a report the office read (server/ea-scenes.js).
   * Its score is net profit over max drawdown. The first scored result of an
   * EA on a symbol and period is the baseline; one that beats the best by
   * BREAKTHROUGH.margin is a breakthrough: counted always, paid the bonus for
   * the first few of a day.
   */
  function noteResult(r) {
    if (!enabled() || !r || typeof r !== 'object') return null
    const net = Number(r.netProfit)
    const dd = Number(r.maxDrawdown)
    const trades = Number(r.trades)
    const expert = clean(String(r.expert ?? '').split(/[\\/]/).pop()?.replace(/\.ex5$/i, ''), 60)
    if (!expert || !(net > 0) || !(dd > 0) || !(trades >= BREAKTHROUGH.minTrades)) return null
    const key = [expert.toLowerCase(), clean(String(r.symbol ?? ''), 20) ?? '', clean(String(r.period ?? ''), 10) ?? ''].join('|')
    const score = net / dd
    const best = state('bestResults', {})
    const prev = best[key]
    if (prev !== undefined && !(score > prev * BREAKTHROUGH.margin)) return { breakthrough: false, score }
    best[key] = score
    const keys = Object.keys(best)
    if (keys.length > 400) delete best[keys[0]]
    setState('bestResults', best)
    if (prev === undefined) return { baseline: true, score }
    const t = now()
    const date = localDate(t)
    const label = `breakthrough: ${expert}${r.symbol ? ` ${clean(String(r.symbol), 20)}` : ''}`
    const paid = q.ledgerDayKind.get(date, 'breakthrough').n < BREAKTHROUGH.paidPerDay
    q.bumpDaily.run(date, 'breakthrough', 0)
    q.bumpCount.run('breakthrough')
    const cash = paid ? addCash('breakthrough', BREAKTHROUGH.bonus, label) : 0
    broadcast({ type: 'progression_update', ...totals(), gain: { kind: 'breakthrough', xp: 0, cash, label }, timestamp: t })
    check()
    return { breakthrough: true, score, cash }
  }

  /** Buy a piece for the office. @returns {{ ok: true, cash: number } | { ok: false, error: string }} */
  function buy(id) {
    if (!enabled()) return { ok: false, error: 'progression is off' }
    const u = UNLOCKS.find(x => x.id === id && x.price)
    if (!u) return { ok: false, error: 'not for sale' }
    if (q.awards.all().some(a => a.id === `unlock:${u.id}`)) return { ok: false, error: 'already bought' }
    const cash = state('cash', 0)
    if (cash < u.price) return { ok: false, error: `needs ${u.price - cash} more` }
    let a = null
    db.transaction(() => {
      addCash('purchase', -u.price, u.title)
      a = award({ id: `unlock:${u.id}`, type: 'unlock', title: u.title, detail: u.detail })
    })()
    broadcast({ type: 'progression_update', ...totals(), timestamp: now() })
    if (a && u.room) announceRooms()
    return a ? { ok: true, cash: state('cash', 0) } : { ok: false, error: 'already bought' }
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * The side rooms the firm has bought. The corridor comes with the first one.
   * @returns {string[] | null} room ids, or null when progression is off (every room is open)
   */
  function rooms() {
    if (!enabled()) return null
    const owned = new Set(q.awards.all().map(a => a.id))
    return UNLOCKS.filter(u => u.room && owned.has(`unlock:${u.id}`)).map(u => u.room)
  }
  function announceRooms() { broadcast({ type: 'office_rooms', rooms: rooms(), timestamp: now() }) }

  function snapshot() {
    const on = enabled()
    const awards = q.awards.all()
    const byId = new Map(awards.map(a => [a.id, a]))
    const c = counts()
    const plantsTotal = q.plantCount.get().n
    const high = state('equityHigh', null)
    return {
      enabled: on,
      ...totals(),
      counts: c,
      tracks: TRACKS.map(tr => ({
        id: tr.id, title: tr.title, count: c[tr.kind] ?? 0,
        tiers: tr.tiers.map((n, i) => ({ tier: TIERS[i], threshold: n, earned: byId.has(`trophy:${tr.id}:${TIERS[i]}`), at: byId.get(`trophy:${tr.id}:${TIERS[i]}`)?.at ?? null })),
      })),
      milestones: MILESTONES.map(m => ({ id: m.id, title: m.title, detail: m.detail, earned: byId.has(`milestone:${m.id}`), at: byId.get(`milestone:${m.id}`)?.at ?? null })),
      unlocks: UNLOCKS.map(u => {
        const a = byId.get(`unlock:${u.id}`)
        // A rare one keeps its secret until it unlocks
        return u.rare && !a
          ? { id: u.id, title: '???', detail: 'A rare unlock', hint: 'Rare', rare: true, unlocked: false, at: null }
          : { id: u.id, title: u.title, detail: u.detail, hint: u.hint ?? (u.price ? `Buy it for $${u.price}` : ''), rare: !!u.rare, unlocked: !!a, at: a?.at ?? null,
              ...(u.price ? { price: u.price, category: u.category } : {}) }
      }),
      awards: awards.slice(-60).map(a => ({ id: a.id, type: a.type, title: a.title, tier: a.tier, detail: a.detail, rare: !!a.rare, at: a.at })),
      lessons: q.lessons.all(30),
      garden: { total: plantsTotal, plants: q.plants.all(24) },
      shipped: (c.pr_merge ?? 0) + (c.deploy ?? 0),
      equity: high ? { high: high.equity, at: high.at, readings: state('equityReadings', 0) } : { high: null, readings: state('equityReadings', 0) },
      recent: q.recent.all(15),
      ledger: q.ledgerRecent.all(20),
      finances: finances(),
      cashRules: { base: CASH_BASE, profitShare: PROFIT_SHARE, breakthrough: BREAKTHROUGH },
      xpRules: { base: XP_BASE, dailyCapFactor: DAILY_CAP_FACTOR, repeatMs: REPEAT_MS },
    }
  }

  /** One day: XP and counts by kind, the awards and lessons of that day. */
  function day(date = localDate(now())) {
    const { counts: dc, xp } = dayKinds(date)
    const kinds = {}
    for (const k of COUNT_KINDS) if (dc[k] || xp[k]) kinds[k] = { count: dc[k], xp: xp[k] }
    return {
      date,
      xp: Object.values(xp).reduce((a, b) => a + b, 0),
      kinds,
      awards: q.awardsRange.all(date, date).map(a => ({ id: a.id, type: a.type, title: a.title, tier: a.tier, rare: !!a.rare, at: a.at })),
      lessons: q.lessonsRange.all(date, date),
    }
  }

  /** One quarter: XP, active days, best day, totals by kind, by month, awards, lessons. */
  function quarter(qtr = quarterOf(localDate(now()))) {
    const { from, to } = quarterRange(qtr)
    const rows = q.rangeRows.all(from, to)
    const byDay = new Map()
    const kinds = {}
    const byMonth = {}
    for (const r of rows) {
      byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.xp)
      kinds[r.kind] = { count: (kinds[r.kind]?.count ?? 0) + r.count, xp: (kinds[r.kind]?.xp ?? 0) + r.xp }
      const m = r.date.slice(0, 7)
      byMonth[m] = (byMonth[m] ?? 0) + r.xp
    }
    let best = null
    for (const [date, xp] of byDay) if (xp > 0 && (!best || xp > best.xp)) best = { date, xp }
    const lessons = q.lessonsRange.all(from, to)
    const topLessons = {}
    for (const l of lessons) topLessons[l.label] = (topLessons[l.label] ?? 0) + 1
    const xp = [...byDay.values()].reduce((a, b) => a + b, 0)
    const fails = (kinds.test_fail?.count ?? 0) + (kinds.build_fail?.count ?? 0)
    const greens = (kinds.test_ok?.count ?? 0) + (kinds.build_ok?.count ?? 0)
    return {
      quarter: qtr, from, to, xp,
      activeDays: [...byDay.values()].filter(v => v > 0).length,
      bestDay: best,
      kinds,
      byMonth,
      greenRate: greens + fails ? Math.round((greens / (greens + fails)) * 100) : null,
      awards: q.awardsRange.all(from, to).map(a => ({ id: a.id, type: a.type, title: a.title, tier: a.tier, rare: !!a.rare, at: a.at })),
      lessons: lessons.length,
      topLessons: Object.entries(topLessons).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, n]) => ({ label, n })),
    }
  }

  function setEnabled(on) {
    setState('enabled', !!on)
    announceRooms()
    broadcast({ type: 'progression_settings', enabled: !!on, timestamp: now() })
    if (on) check()
  }

  /** Wipe the books (XP, trophies, unlocks, lessons, garden, history). The on/off setting stays. */
  function reset() {
    const keep = enabled()
    db.transaction(() => {
      for (const t of ['progression_state', 'progression_daily', 'progression_counts', 'progression_seen', 'progression_awards', 'progression_lessons', 'progression_garden', 'progression_log', 'progression_ledger', 'progression_cashflow']) db.prepare(`DELETE FROM ${t}`).run()
      setState('enabled', keep)
    })()
    lastBy.clear(); signalFails.clear()
    broadcast({ type: 'progression_reset', timestamp: now() })
    announceRooms()
    if (keep) check()
    log.log?.('[progression] reset')
  }

  // Anything earned while the module was older
  if (enabled()) check()

  return { noteBroadcast, noteFact, noteEquity, noteResult, buy, rooms, snapshot, day, quarter, enabled, setEnabled, reset, check, gain }
}
