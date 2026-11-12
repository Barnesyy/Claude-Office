/**
 * progression.test.ts - the progression store (server/progression.js): XP
 * from real events only, diminishing returns, the daily cap, repeats and
 * replays that count nothing, failures that earn nothing, trophies,
 * milestones, unlocks (rare ones hidden), lessons, the garden, demo equity,
 * on/off and reset, and the day / quarter reads.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  createProgression, xpFor, levelFloor, levelOf, levelTitle, XP_BASE, DAILY_CAP_FACTOR, REPEAT_MS, quarterOf, isQuarter,
  SIGNAL_LESSON_WAIT_MS,
} from '../server/progression.js'

type Sent = { type: string; [k: string]: any }

function fresh(start = new Date(2026, 10, 12, 10, 0, 0).getTime()) {
  const clock = { t: start }
  const sent: Sent[] = []
  const deferred: (() => void)[] = []
  const db = new Database(':memory:')
  const p = createProgression(db, {
    now: () => clock.t,
    broadcast: (m: Sent) => { sent.push(m) },
    log: { log() {}, warn() {} } as any,
    defer: (fn: () => void) => { deferred.push(fn) },
  })
  const tick = (ms: number) => { clock.t += ms }
  const runDeferred = () => { while (deferred.length) deferred.shift()!() }
  return { p, db, clock, sent, tick, runDeferred }
}

const S = 'sess-1'

describe('the rules', () => {
  it('xpFor shrinks with each repeat of a kind in a day and never goes below 1', () => {
    expect(xpFor('commit', 0)).toBe(XP_BASE.commit)
    const seq = Array.from({ length: 30 }, (_, n) => xpFor('commit', n))
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThanOrEqual(seq[i - 1])
    expect(seq.at(-1)).toBeGreaterThanOrEqual(1)
  })
  it('xpFor stops at the daily cap', () => {
    const cap = XP_BASE.turn * DAILY_CAP_FACTOR
    expect(xpFor('turn', 3, cap)).toBe(0)
    expect(xpFor('turn', 0, cap - 2)).toBe(2)
  })
  it('xpFor gives nothing to a kind without a base (failures)', () => {
    expect(xpFor('test_fail', 0)).toBe(0)
  })
  it('levels climb on a curve and have titles', () => {
    expect(levelFloor(1)).toBe(0)
    expect(levelOf(0)).toBe(1)
    expect(levelOf(levelFloor(2))).toBe(2)
    expect(levelOf(levelFloor(2) - 1)).toBe(1)
    for (let l = 2; l < 30; l++) expect(levelFloor(l + 1) - levelFloor(l)).toBeGreaterThan(levelFloor(l) - levelFloor(l - 1) - 1)
    expect(levelTitle(1)).toBe('Back Office')
    expect(levelTitle(20)).toBe('Corner Office')
  })
  it('quarters', () => {
    expect(quarterOf('2026-11-12')).toBe('2026-Q4')
    expect(quarterOf('2026-01-01')).toBe('2026-Q1')
    expect(isQuarter('2026-Q3')).toBe(true)
    expect(isQuarter('2026-Q5')).toBe(false)
    expect(isQuarter('drop table')).toBe(false)
  })
})

describe('createProgression: events from the office', () => {
  let t: ReturnType<typeof fresh>
  beforeEach(() => { t = fresh() })

  it('starts at level 1 with the trophy cabinet open and nothing else', () => {
    const s = t.p.snapshot()
    expect(s).toMatchObject({ enabled: true, xp: 0, level: 1, streak: 0 })
    expect(s.unlocks.find((u: any) => u.id === 'trophy-cabinet').unlocked).toBe(true)
    expect(s.unlocks.filter((u: any) => u.unlocked)).toHaveLength(1)
  })

  it('a finished turn earns XP once, however often it is replayed', () => {
    const turn = { type: 'session_turn_end', sessionId: S, promptId: 'p1', project: 'School Run' }
    t.p.noteBroadcast(turn); t.p.noteBroadcast(turn)
    const s = t.p.snapshot()
    expect(s.xp).toBe(XP_BASE.turn)
    expect(s.counts.turn).toBe(1)
    expect(s.milestones.find((m: any) => m.id === 'first-turn').earned).toBe(true)
    expect(t.sent.some(m => m.type === 'progression_update' && m.gain.kind === 'turn' && m.gain.xp === XP_BASE.turn)).toBe(true)
    expect(t.sent.some(m => m.type === 'progression_award' && m.award.id === 'milestone:first-turn')).toBe(true)
  })

  it('a worker that finished earns; one that failed, stopped or went quiet earns nothing', () => {
    t.p.noteBroadcast({ type: 'agent_completed', agentId: 'a1', result: 'Fixed the 3 failing tests' })
    t.p.noteBroadcast({ type: 'agent_completed', agentId: 'a2', result: 'failed: tool error' })
    t.p.noteBroadcast({ type: 'agent_completed', agentId: 'a3', result: 'stopped' })
    t.p.noteBroadcast({ type: 'agent_completed', agentId: 'a4', result: 'went quiet, cleared' })
    const s = t.p.snapshot()
    expect(s.counts.worker).toBe(1)
    expect(s.counts.worker_fail).toBe(3)
    expect(s.xp).toBe(XP_BASE.worker)
  })

  it('failed tests and builds are counted for the recap but earn no XP, however many', () => {
    for (let i = 0; i < 20; i++) { t.p.noteBroadcast({ type: 'signal', kind: 'test_failed', sessionId: S }); t.tick(1000) }
    t.p.noteBroadcast({ type: 'signal', kind: 'build_failed', sessionId: S })
    const s = t.p.snapshot()
    expect(s.xp).toBe(0)
    expect(s.counts.test_fail).toBe(20)
    expect(s.counts.build_fail).toBe(1)
  })

  it('the same green signal within 90 s counts nothing (spam guard); after that it counts, for less', () => {
    t.p.noteBroadcast({ type: 'signal', kind: 'test_ok', sessionId: S, target: 'unit' })
    t.tick(10_000)
    t.p.noteBroadcast({ type: 'signal', kind: 'test_ok', sessionId: S, target: 'unit' })
    expect(t.p.snapshot().counts.test_ok).toBe(1)
    t.tick(REPEAT_MS)
    t.p.noteBroadcast({ type: 'signal', kind: 'test_ok', sessionId: S, target: 'unit' })
    const s = t.p.snapshot()
    expect(s.counts.test_ok).toBe(2)
    expect(s.xp).toBe(XP_BASE.test_ok + xpFor('test_ok', 1))
    expect(t.p.day().kinds.repeat.count).toBe(1)
  })

  it('an interrupted run earns nothing', () => {
    t.p.noteBroadcast({ type: 'signal', kind: 'test_ok', sessionId: S, interrupted: true })
    expect(t.p.snapshot().xp).toBe(0)
  })

  it('a day of the same thing hits the cap', () => {
    for (let i = 0; i < 200; i++) { t.p.noteBroadcast({ type: 'session_turn_end', sessionId: S, promptId: `p${i}` }); t.tick(1000) }
    expect(t.p.snapshot().xp).toBe(XP_BASE.turn * DAILY_CAP_FACTOR)
  })

  it('turns and workers the watcher replayed from history at start-up earn nothing', () => {
    t.p.noteBroadcast({ type: 'session_turn_end', sessionId: S, promptId: 'old', replayed: true } as any)
    t.p.noteBroadcast({ type: 'agent_completed', agentId: 'old-w', result: 'done', replayed: true } as any)
    expect(t.p.snapshot().xp).toBe(0)
    t.p.noteBroadcast({ type: 'session_turn_end', sessionId: S, promptId: 'live' })
    expect(t.p.snapshot().xp).toBeGreaterThan(0)
  })

  it('its own broadcasts are ignored (no loop)', () => {
    t.p.noteBroadcast({ type: 'progression_update', xp: 99999 } as any)
    t.p.noteBroadcast({ type: 'progression_award', award: { id: 'x' } } as any)
    expect(t.p.snapshot().xp).toBe(0)
  })

  it('without the watcher, a failed signal then a green one is a lesson (after a short wait)', () => {
    t.p.noteBroadcast({ type: 'signal', kind: 'test_failed', sessionId: S })
    t.tick(30_000)
    t.p.noteBroadcast({ type: 'signal', kind: 'test_ok', sessionId: S })
    expect(t.p.snapshot().lessons).toHaveLength(0)
    t.tick(SIGNAL_LESSON_WAIT_MS); t.runDeferred()
    const s = t.p.snapshot()
    expect(s.lessons).toEqual([expect.objectContaining({ label: 'tests', fails: 1, ms: 30_000 })])
    expect(s.unlocks.find((u: any) => u.id === 'lessons-binder').unlocked).toBe(true)
  })

  it('a watcher fact right after the green signal stands the signal lesson down (no double lesson)', () => {
    t.p.noteBroadcast({ type: 'signal', kind: 'test_failed', sessionId: S })
    t.p.noteBroadcast({ type: 'signal', kind: 'test_ok', sessionId: S })
    t.tick(5)
    t.p.noteFact({ kind: 'lesson', id: 'tu1:lesson', label: 'vitest run', fails: 1, ms: 100, sessionId: S })
    t.runDeferred()
    expect(t.p.snapshot().lessons.map((l: any) => l.label)).toEqual(['vitest run'])
  })
})

describe('createProgression: facts from the transcript watcher', () => {
  let t: ReturnType<typeof fresh>
  beforeEach(() => { t = fresh() })

  it('rejects unknown kinds and junk', () => {
    expect(t.p.noteFact({ kind: 'free_xp' })).toBe(false)
    expect(t.p.noteFact(null)).toBe(false)
    expect(t.p.noteFact('commit' as any)).toBe(false)
    expect(t.p.snapshot().xp).toBe(0)
  })

  it('a commit, a push and a merged PR: XP, a parcel, a plant, the bin and garden unlock', () => {
    t.p.noteFact({ kind: 'commit', id: 'c1:commit', label: 'git commit', sessionId: S })
    t.p.noteFact({ kind: 'push', id: 'c2:push', label: 'git push', sessionId: S })
    t.p.noteFact({ kind: 'pr_merge', id: 'c3:pr_merge', pr: 42, repo: 'Barnesyy/school-run', sessionId: S })
    t.p.noteFact({ kind: 'pr_merge', id: 'c3:pr_merge', pr: 42, repo: 'Barnesyy/school-run', sessionId: S }) // replay
    const s = t.p.snapshot()
    expect(s.xp).toBe(XP_BASE.commit + XP_BASE.push + XP_BASE.pr_merge)
    expect(s.shipped).toBe(1)
    expect(s.garden.plants).toEqual([expect.objectContaining({ key: 'Barnesyy/school-run#42', pr: 42 })])
    const on = s.unlocks.filter((u: any) => u.unlocked).map((u: any) => u.id)
    expect(on).toEqual(expect.arrayContaining(['shipped-bin', 'rooftop-garden']))
  })

  it('an MT5 tester run: the run, its report, and walk-forward each count', () => {
    t.p.noteFact({ kind: 'mt5_run', id: 'm1:mt5_run', label: 'terminal64 wf.ini', walkForward: true, report: true, sessionId: S })
    const s = t.p.snapshot()
    expect(s.counts).toMatchObject({ mt5_run: 1, mt5_report: 1, walk_forward: 1 })
    expect(s.xp).toBe(XP_BASE.mt5_run + XP_BASE.mt5_report + XP_BASE.walk_forward)
    expect(s.tracks.find((x: any) => x.id === 'walkforward').tiers[0].earned).toBe(true)
    expect(s.unlocks.find((u: any) => u.id === 'backtest-bay').unlocked).toBe(true)
  })

  it('a plain backtest is not walk-forward and a run without a fresh report is not a report', () => {
    t.p.noteFact({ kind: 'mt5_run', id: 'm2:mt5_run', walkForward: false, report: false, sessionId: S })
    expect(t.p.snapshot().counts).toMatchObject({ mt5_run: 1, mt5_report: 0, walk_forward: 0 })
  })

  it('a compile with errors, a failed test fact: no XP', () => {
    t.p.noteFact({ kind: 'ea_compile', id: 'e1', ok: false })
    t.p.noteFact({ kind: 'test', id: 't1', ok: false, label: 'pytest' })
    const s = t.p.snapshot()
    expect(s.xp).toBe(0)
    expect(s.counts).toMatchObject({ ea_compile_fail: 1, test_fail: 1 })
  })

  it('ten walk-forwards unlock the rare golden bull, hidden until then', () => {
    const bull = () => t.p.snapshot().unlocks.find((u: any) => u.id === 'golden-bull')
    expect(bull()).toMatchObject({ title: '???', unlocked: false })
    for (let i = 0; i < 10; i++) { t.p.noteFact({ kind: 'mt5_run', id: `w${i}`, walkForward: true, sessionId: S, label: `run ${i}` }); t.tick(REPEAT_MS + 1) }
    expect(bull()).toMatchObject({ title: 'Golden bull', unlocked: true, rare: true })
    expect(t.sent.some(m => m.type === 'progression_award' && m.award.id === 'unlock:golden-bull' && m.award.rare)).toBe(true)
  })

  it('a fix after five failures files a lesson and unlocks the clover', () => {
    t.p.noteFact({ kind: 'lesson', id: 'l1', label: 'npm run build', fails: 5, ms: 600_000, sessionId: S })
    const s = t.p.snapshot()
    expect(s.lessons[0]).toMatchObject({ label: 'npm run build', fails: 5, ms: 600_000 })
    expect(s.unlocks.find((u: any) => u.id === 'clover').unlocked).toBe(true)
  })

  it('labels are cut short and stripped of control characters', () => {
    t.p.noteFact({ kind: 'commit', id: 'x', label: 'git\u0000 commit' + 'x'.repeat(500) })
    const r = t.p.snapshot().recent[0]
    expect(r.label.length).toBeLessThanOrEqual(80)
    expect(r.label).not.toMatch(/\u0000/)
  })
})

describe('demo equity', () => {
  it('the first reading is a baseline, a later higher one is a new high, the same file twice is nothing', () => {
    const t = fresh()
    expect(t.p.noteEquity([{ equity: 10000, login: '123', mtimeMs: 1 }])).toEqual({ baseline: true, equity: 10000 })
    expect(t.p.snapshot().counts.equity_high).toBe(0)
    expect(t.p.snapshot().unlocks.find((u: any) => u.id === 'equity-wall').unlocked).toBe(true)
    expect(t.p.noteEquity([{ equity: 10000, login: '123', mtimeMs: 1 }])).toBeNull()
    expect(t.p.noteEquity([{ equity: 9900, login: '123', mtimeMs: 2 }])).toEqual({ equity: 9900 })
    expect(t.p.noteEquity([{ equity: 10250.5, login: '123', mtimeMs: 3 }])).toEqual({ high: true, equity: 10250.5 })
    const s = t.p.snapshot()
    expect(s.counts.equity_high).toBe(1)
    expect(s.equity).toMatchObject({ high: 10250.5, readings: 3 })
  })
  it('nothing to read is nothing', () => {
    const t = fresh()
    expect(t.p.noteEquity([])).toBeNull()
    expect(t.p.noteEquity([{ equity: NaN }])).toBeNull()
    expect(t.p.snapshot().equity).toEqual({ high: null, readings: 0 })
  })
})

describe('on/off, reset, day and quarter', () => {
  it('off: nothing counts; on again: it does', () => {
    const t = fresh()
    t.p.setEnabled(false)
    expect(t.sent.at(-1)).toMatchObject({ type: 'progression_settings', enabled: false })
    t.p.noteBroadcast({ type: 'session_turn_end', sessionId: S, promptId: 'p1' })
    t.p.noteFact({ kind: 'commit', id: 'c' })
    expect(t.p.snapshot()).toMatchObject({ enabled: false, xp: 0 })
    t.p.setEnabled(true)
    t.p.noteBroadcast({ type: 'session_turn_end', sessionId: S, promptId: 'p2' })
    expect(t.p.snapshot().xp).toBe(XP_BASE.turn)
  })

  it('reset wipes the books but keeps the setting, and survives a reopen of the db', () => {
    const t = fresh()
    t.p.noteFact({ kind: 'pr_merge', id: 'p', pr: 1, repo: 'a/b' })
    t.p.noteFact({ kind: 'lesson', id: 'l', label: 'x', fails: 1 })
    t.p.reset()
    const s = t.p.snapshot()
    expect(s).toMatchObject({ xp: 0, level: 1, shipped: 0, lessons: [], enabled: true })
    expect(s.garden.plants).toEqual([])
    expect(s.unlocks.filter((u: any) => u.unlocked).map((u: any) => u.id)).toEqual(['trophy-cabinet'])
    expect(t.sent.some(m => m.type === 'progression_reset')).toBe(true)
    // the replayed fact counts again after a reset (its seen key went too)
    t.p.noteFact({ kind: 'pr_merge', id: 'p', pr: 1, repo: 'a/b' })
    expect(t.p.snapshot().xp).toBe(XP_BASE.pr_merge)
  })

  it('persists across a new store on the same db', () => {
    const t = fresh()
    t.p.noteFact({ kind: 'commit', id: 'c1' })
    const again = createProgression(t.db, { now: () => t.clock.t, log: { log() {} } as any })
    expect(again.snapshot().xp).toBe(XP_BASE.commit)
    again.noteFact({ kind: 'commit', id: 'c1' })
    expect(again.snapshot().counts.commit).toBe(1)
  })

  it('a streak counts consecutive active days; the day and quarter reads add up', () => {
    const t = fresh(new Date(2026, 9, 30, 12).getTime())
    for (let d = 0; d < 3; d++) {
      t.p.noteBroadcast({ type: 'session_turn_end', sessionId: S, promptId: `d${d}` })
      t.tick(24 * 3600_000)
    }
    t.tick(-24 * 3600_000)
    const s = t.p.snapshot()
    expect(s.streak).toBe(3)
    expect(s.milestones.find((m: any) => m.id === 'streak-3').earned).toBe(true)
    expect(t.p.day('2026-10-31')).toMatchObject({ date: '2026-10-31', xp: XP_BASE.turn, kinds: { turn: { count: 1, xp: XP_BASE.turn } } })
    const q = t.p.quarter('2026-Q4')
    expect(q).toMatchObject({ quarter: '2026-Q4', from: '2026-10-01', to: '2026-12-31', xp: 3 * XP_BASE.turn, activeDays: 3 })
    expect(q.byMonth).toEqual({ '2026-10': 2 * XP_BASE.turn, '2026-11': XP_BASE.turn })
    expect(t.p.quarter('2026-Q3').xp).toBe(0)
  })

  it('green rate in the quarter: greens over greens plus fails', () => {
    const t = fresh()
    t.p.noteBroadcast({ type: 'signal', kind: 'test_ok', sessionId: S, target: 'a' })
    t.p.noteBroadcast({ type: 'signal', kind: 'test_failed', sessionId: S })
    t.p.noteBroadcast({ type: 'signal', kind: 'build_ok', sessionId: S })
    t.p.noteBroadcast({ type: 'signal', kind: 'build_ok', sessionId: 'other' })
    expect(t.p.quarter().greenRate).toBe(75)
  })

  it('levelling up awards each level once', () => {
    const t = fresh()
    for (let i = 0; i < 6; i++) { t.p.noteFact({ kind: 'pr_merge', id: `p${i}`, pr: i, repo: 'a/b' }); t.tick(1000) }
    const lv = t.p.snapshot().awards.filter((a: any) => a.type === 'level')
    expect(lv.length).toBe(t.p.snapshot().level - 1)
    expect(new Set(lv.map((a: any) => a.id)).size).toBe(lv.length)
  })
})
