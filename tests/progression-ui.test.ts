/**
 * progression-ui.test.ts - the client side of progression (src/progression.ts):
 * live events applied to the store, the cabinet / garden / bin helpers, the
 * mailbox flag, and every sprite the layer draws existing in public/.
 */

import { describe, expect, it } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  applyProgressionEvent, cabinetTrophies, gardenPlants, parcelsShown, xpProgress, hasNews, isUnlocked, isRevealing, formatDuration,
  kindRows, quarterOf, previousQuarter, quarterMonths, artSize, SPRITES, TROPHY_SPRITES, PLANT_SPRITES, SHEET_SPRITES, REVEAL_MS,
  CABINET_SHELVES, PLANTER_SLOTS, type ProgressionState, type ProgressionSnapshot, type Track,
} from '../src/progression'

const track = (id: string, earned: number, at = 1): Track => ({
  id, title: id, count: earned,
  tiers: (['bronze', 'silver', 'gold', 'platinum'] as const).map((tier, i) => ({ tier, threshold: i + 1, earned: i < earned, at: i < earned ? at + i : null })),
})

function snap(over: Partial<ProgressionSnapshot> = {}): ProgressionSnapshot {
  return {
    enabled: true, xp: 0, level: 1, title: 'Back Office', levelFloor: 0, nextLevelXp: 150, todayXp: 0, streak: 0,
    counts: { turn: 0 }, tracks: [], milestones: [], awards: [],
    unlocks: [{ id: 'mailbox', title: 'Mailbox', detail: '', hint: '', rare: false, unlocked: false, at: null }],
    lessons: [], garden: { total: 0, plants: [] }, shipped: 0, equity: { high: null, readings: 0 }, recent: [],
    ...over,
  } as ProgressionSnapshot
}
const base = (s: ProgressionSnapshot | null = snap()): ProgressionState => ({ snapshot: s, toasts: [], reveals: [], lastGain: null, panel: null, seenAt: 0 })

describe('applyProgressionEvent', () => {
  it('an update moves the totals, counts the kind and floats the gain', () => {
    const s = applyProgressionEvent(base(), { type: 'progression_update', xp: 25, level: 1, gain: { kind: 'turn', xp: 10 } } as any, 1000)
    expect(s.snapshot).toMatchObject({ xp: 25, counts: { turn: 1 } })
    expect(s.lastGain).toMatchObject({ kind: 'turn', xp: 10, at: 1000 })
  })
  it('a zero-XP update does not float', () => {
    expect(applyProgressionEvent(base(), { type: 'progression_update', xp: 0, gain: { kind: 'turn', xp: 0 } } as any).lastGain).toBeNull()
  })
  it('an unlock marks it unlocked, toasts it and starts its reveal; the same award twice adds no second entry', () => {
    const award = { id: 'unlock:mailbox', type: 'unlock', title: 'Mailbox', at: 5 } as any
    let s = applyProgressionEvent(base(), { type: 'progression_award', award }, 100)
    expect(isUnlocked(s.snapshot, 'mailbox')).toBe(true)
    expect(s.toasts).toHaveLength(1)
    expect(isRevealing(s, 'mailbox', 100 + REVEAL_MS - 1)).toBe(true)
    expect(isRevealing(s, 'mailbox', 100 + REVEAL_MS + 1)).toBe(false)
    s = applyProgressionEvent(s, { type: 'progression_award', award }, 200)
    expect(s.snapshot!.awards).toHaveLength(1)
  })
  it('a trophy marks its tier; settings flip enabled; a reset clears the toasts', () => {
    let s = applyProgressionEvent(base(snap({ tracks: [track('prs', 0)] })), { type: 'progression_award', award: { id: 'trophy:prs:bronze', type: 'trophy', title: 'PRs', tier: 'bronze', at: 9 } as any })
    expect(s.snapshot!.tracks[0].tiers[0]).toMatchObject({ earned: true, at: 9 })
    s = applyProgressionEvent(s, { type: 'progression_settings', enabled: false })
    expect(s.snapshot!.enabled).toBe(false)
    s = applyProgressionEvent(s, { type: 'progression_reset' } as any)
    expect(s.toasts).toEqual([])
  })
  it('events before the first snapshot are harmless', () => {
    expect(applyProgressionEvent(base(null), { type: 'progression_update', xp: 5 } as any).snapshot).toBeNull()
  })
})

describe('room helpers', () => {
  it('the cabinet shows each track\'s best tier, best first, within its slots', () => {
    const out = cabinetTrophies([track('a', 1, 10), track('b', 3, 5), track('c', 0), track('d', 4, 1)], 2)
    expect(out.map(t => [t.track, t.tier])).toEqual([['d', 'platinum'], ['b', 'gold']])
  })
  it('the garden plants the newest PRs, oldest of them at the back, sprites from their seed', () => {
    const plants = [3, 2, 1].map(n => ({ key: `r#${n}`, repo: 'r', pr: n, seed: n, at: n }))
    const g = gardenPlants(plants, 2)
    expect(g.map(p => p.key)).toEqual(['r#2', 'r#3'])
    expect(g[1]).toMatchObject({ slot: 1, label: 'PR #3 · r', sprite: PLANT_SPRITES[3 % PLANT_SPRITES.length] })
  })
  it('parcels pile up to six', () => {
    expect([0, 1, 6, 40].map(parcelsShown)).toEqual([0, 1, 6, 6])
  })
  it('xp progress through the level', () => {
    expect(xpProgress({ xp: 75, levelFloor: 0, nextLevelXp: 150 })).toBe(0.5)
    expect(xpProgress({ xp: 999, levelFloor: 0, nextLevelXp: 150 })).toBe(1)
  })
  it('the mailbox flag: an award newer than the last look (the always-open cabinet is no news)', () => {
    const s = snap({ awards: [{ id: 'unlock:trophy-cabinet', type: 'unlock', title: '', at: 50 } as any] })
    expect(hasNews({ snapshot: s, seenAt: 0 })).toBe(false)
    s.awards.push({ id: 'milestone:first-turn', type: 'milestone', title: '', at: 60 } as any)
    expect(hasNews({ snapshot: s, seenAt: 0 })).toBe(true)
    expect(hasNews({ snapshot: s, seenAt: 60 })).toBe(false)
  })
  it('durations, rows, quarters', () => {
    expect(formatDuration(10_000)).toBe('under a minute')
    expect(formatDuration(65 * 60_000)).toBe('1 h 5 min')
    expect(kindRows({ test_fail: { count: 2, xp: 0 }, turn: { count: 1, xp: 10 }, pr_merge: { count: 1, xp: 60 }, repeat: { count: 0, xp: 0 } }).map(r => r.kind))
      .toEqual(['pr_merge', 'turn', 'test_fail'])
    expect(quarterOf(new Date(2026, 10, 12))).toBe('2026-Q4')
    expect(previousQuarter('2026-Q1')).toBe('2025-Q4')
    expect(quarterMonths('2026-10-01')).toEqual(['2026-10', '2026-11', '2026-12'])
  })
})

describe('the art', () => {
  const all = [...Object.values(SPRITES), ...Object.values(TROPHY_SPRITES), ...PLANT_SPRITES, ...Object.values(SHEET_SPRITES)]
  it.each(all)('%s is in public/', p => {
    expect(existsSync(join(__dirname, '..', 'public', p))).toBe(true)
  })
  it('the generated sprites have their sizes and the cabinet / planter their slots', () => {
    expect(artSize('/sprites/progression/trophy-cabinet.png').w).toBeGreaterThan(20)
    expect(CABINET_SHELVES.flat().length).toBeGreaterThanOrEqual(8)
    expect(PLANTER_SLOTS.length).toBeGreaterThanOrEqual(6)
  })
})
