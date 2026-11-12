/**
 * The merged office (ea-integrate): the progression props, the EA scenes and
 * the lounge share one room. Footprints (foot at x/y %, drawn size in px of
 * the 800 x 600 room) must not pile onto each other, and the room has one
 * backtest station and one equity display (progression unlocks only add
 * extras to them).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import ProgressionLayer, { SPOTS } from '../src/components/ProgressionLayer'
import EaScene, { STATION_SPOTS, CABINET_SPOTS } from '../src/components/EaScene'
import { ASSETS } from '../src/assets'
import { ROOMS } from '../src/rooms'
import { artSize, resetProgressionStore, SPRITES, type ProgressionSnapshot } from '../src/progression'

const ROOM = ROOMS['main-office']
type Box = { id: string; x0: number; x1: number; y0: number; y1: number }
const box = (id: string, x: number, y: number, wPx: number, hPx: number): Box =>
  ({ id, x0: x - (wPx / 800) * 50, x1: x + (wPx / 800) * 50, y0: y - (hPx / 600) * 100, y1: y })
const asset = (id: string, sprite: string, x: number, y: number) => box(id, x, y, ASSETS[sprite].width, ASSETS[sprite].height)
const art = (id: string, src: string, x: number, y: number) => { const s = artSize(src); return box(id, x, y, s.w, s.h) }
/** How much of the smaller box the two share (0..1) */
function shared(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  if (w <= 0 || h <= 0) return 0
  const area = (q: Box) => (q.x1 - q.x0) * (q.y1 - q.y0)
  return (w * h) / Math.min(area(a), area(b))
}

const progression = [
  art('trophy cabinet', SPRITES.cabinet, SPOTS.cabinet.x, SPOTS.cabinet.y),
  art('mailbox', SPRITES.mailboxUp, SPOTS.mailbox.x, SPOTS.mailbox.y),
  art('shipped bin', SPRITES.bin, SPOTS.bin.x, SPOTS.bin.y),
  art('garden planter', SPRITES.planter, SPOTS.planter.x, SPOTS.planter.y),
  box('money tree', SPOTS['money-tree'].x, SPOTS['money-tree'].y, 38, 58),
]
const ea = [
  asset('EA rack', 'server-rack-1', STATION_SPOTS.rack.x, STATION_SPOTS.rack.y),
  asset('EA cart', 'crash-cart', STATION_SPOTS.cart.x, STATION_SPOTS.cart.y),
  ...CABINET_SPOTS.map((c, i) => asset(`tick cabinet ${i + 1}`, 'filing-closed', c.x, c.y)),
]
const room = ROOM.furniture
  .filter(f => ASSETS[f.sprite] && f.type !== 'hotspot')
  .map(f => asset(f.id, f.sprite, f.x, f.y))

describe('one room, no pile-ups', () => {
  it('progression props and EA scene props do not sit on each other', () => {
    for (const p of progression) for (const e of ea) {
      expect(shared(p, e), `${p.id} vs ${e.id}`).toBeLessThan(0.25)
    }
  })

  it('neither sits on the room\'s desks, plants or lounge', () => {
    for (const p of [...progression, ...ea]) for (const f of room) {
      expect(shared(p, f), `${p.id} vs ${f.id}`).toBeLessThan(0.35)
    }
  })

  it('the progression props keep apart from each other', () => {
    for (let i = 0; i < progression.length; i++) for (let j = i + 1; j < progression.length; j++) {
      expect(shared(progression[i], progression[j]), `${progression[i].id} vs ${progression[j].id}`).toBe(0)
    }
  })

  it('the backtest bay\'s sheet stands where the EA station\'s cart does (one station)', () => {
    expect(SPOTS['backtest-bay']).toEqual({ x: STATION_SPOTS.cart.x, y: STATION_SPOTS.cart.y })
  })
})

const SNAP = (unlocked: string[]): ProgressionSnapshot => ({
  enabled: true, xp: 500, level: 3, title: 'Analyst', levelFloor: 400, nextLevelXp: 700, todayXp: 0, streak: 2,
  counts: { mt5_run: 7, walk_forward: 2, lesson: 1 }, shipped: 2, awards: [], lessons: [], recent: [],
  tracks: [], milestones: [], garden: { total: 0, plants: [] }, equity: { high: 101234.5, readings: 2 },
  unlocks: ['trophy-cabinet', 'mailbox', 'lessons-binder', 'shipped-bin', 'rooftop-garden', 'backtest-bay', 'equity-wall', 'money-tree']
    .map(id => ({ id, title: id, detail: '', hint: 'hint', unlocked: unlocked.includes(id), rare: false })),
} as unknown as ProgressionSnapshot)

describe('one backtest station, one equity display', () => {
  afterEach(() => resetProgressionStore())

  it('progression draws no second rack and no second equity chart', () => {
    resetProgressionStore({ snapshot: SNAP(['backtest-bay', 'equity-wall']) })
    const html = renderToStaticMarkup(createElement(ProgressionLayer))
    expect(html).not.toContain(SPRITES.rack)
    expect(html).not.toContain(SPRITES.equity)
    expect(html).toContain('MT5 7 · WF 2')               // the bay is the station's run plate
    expect(html).toContain('DEMO HIGH 101,235')          // the equity wall is a plate, read from the report
  })

  it('the cart waits under its dust sheet until the backtest bay unlocks; the rack never does', () => {
    resetProgressionStore({ snapshot: SNAP([]) })
    const locked = renderToStaticMarkup(createElement(EaScene, { agents: [] }))
    expect(locked).toContain(ASSETS['server-rack-1'].path)
    expect(locked).not.toContain(ASSETS['crash-cart'].path)
    expect(renderToStaticMarkup(createElement(ProgressionLayer))).toContain('prog-locked-backtest-bay')

    resetProgressionStore({ snapshot: SNAP(['backtest-bay']) })
    expect(renderToStaticMarkup(createElement(EaScene, { agents: [] }))).toContain(ASSETS['crash-cart'].path)
  })

  it('with progression off the EA station is whole', () => {
    resetProgressionStore({ snapshot: null })
    expect(renderToStaticMarkup(createElement(EaScene, { agents: [] }))).toContain(ASSETS['crash-cart'].path)
  })
})
