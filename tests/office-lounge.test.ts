/**
 * The office lounge and desk handover (src/officeReducer.ts, src/rooms.ts):
 * with more live threads than desks, a Claude between turns sits in the
 * lounge instead of "waiting for a desk", and a busy waiter takes the desk of
 * a Claude that has sat idle a while.
 */
import { describe, expect, it } from 'vitest'
import {
  reduceOffice, stepOffice, initialOfficeState, MAIN_ROOM, BOSS_ID, LOUNGE_SPOTS, lobbyPosition, lobbyFacing,
  DESK_HANDOVER_IDLE_MS, needsDesk, noDeskLabel,
  type OfficeAction, type OfficeEnv, type OfficeState,
} from '../src/officeReducer'
import { mainId } from '../src/mainState'
import { createAgent } from '../src/agentManager'
import type { Agent } from '../src/types'

const T0 = 1_000_000
const env = (over: Partial<OfficeEnv> = {}): OfficeEnv => ({ now: T0, live: true, computePath: () => [], random: () => 0.5, ...over })
const spot = (id: string) => MAIN_ROOM.agentSpots.find(s => s.id === id)!
function seated(id: string, role: string, spotId: string): Agent {
  const a = createAgent({ id, name: id, role, spot: spot(spotId), hiredAt: T0 })
  return { ...a, state: 'working', position: { ...a.deskPosition }, pathQueue: [] }
}
function settle(state: OfficeState, e = env()): OfficeState {
  for (let i = 0; i < 3000; i++) {
    const r = stepOffice(state, 3, e)
    if (!r.changed) return state
    state = r.state
  }
  throw new Error('did not settle')
}
function dispatch(state: OfficeState, actions: OfficeAction[], e = env()): OfficeState {
  for (const a of actions) state = reduceOffice(state, a, e).state
  return state
}
const S = (i: number) => ({ sessionId: `s${i}`, project: `p${i}`, cwd: `/ea/thread-${i}` })
const DESKS = MAIN_ROOM.agentSpots.filter(s => s.type === 'desk').length

/** The boss plus n session Claudes, every one idle (turn over) and settled */
function threads(n: number, e = env()): OfficeState {
  let s = initialOfficeState([seated(BOSS_ID, 'boss', 'spot-1')], T0)
  for (let i = 1; i <= n; i++) {
    s = dispatch(s, [{ type: 'session_started', ...S(i) }, { type: 'session_turn_end', ...S(i), text: 'done', backgroundTasks: [] }], e)
  }
  return settle(s, e)
}

describe('the lounge', () => {
  it('has eight places, and the first lobby slots are its places (then the wall by the door)', () => {
    expect(LOUNGE_SPOTS).toHaveLength(8)
    LOUNGE_SPOTS.forEach((p, i) => {
      expect(lobbyPosition(i)).toEqual({ x: p.x, y: p.y })
      expect(lobbyFacing(i)).toBe(p.spriteFacing)
    })
    const wall = lobbyPosition(LOUNGE_SPOTS.length)
    expect(LOUNGE_SPOTS.some(p => p.x === wall.x && p.y === wall.y)).toBe(false)
  })

  it('16 threads: the desks fill, the rest sit in the lounge, and nobody idle says "waiting for a desk"', () => {
    const s = threads(16)
    const mains = s.agents.filter(a => a.id.startsWith(mainId('')))
    expect(mains).toHaveLength(16)
    const atDesk = mains.filter(a => a.assignedSpotId)
    const lounging = mains.filter(a => a.state === 'waiting')
    expect(atDesk).toHaveLength(DESKS - 1)           // the boss has one desk
    expect(lounging).toHaveLength(16 - (DESKS - 1))
    expect(lounging.every(a => noDeskLabel(a) === 'in the lounge')).toBe(true)
    // ...on lounge places, not queued at the door
    expect(lounging.every(a => LOUNGE_SPOTS.some(p => Math.abs(p.x - a.position.x) < 0.5 && Math.abs(p.y - a.position.y) < 0.5))).toBe(true)
  })

  it('a busy waiter takes the desk of the Claude idle longest, once it has been idle DESK_HANDOVER_IDLE_MS', () => {
    const s = threads(DESKS)                           // the boss has a desk: one Claude in the lounge
    const lounger = s.agents.find(a => a.state === 'waiting')!
    expect(needsDesk(lounger)).toBe(false)
    const sid = lounger.sessionId!

    // A prompt lands for the lounger: it is busy now, but every idle Claude has only just sat down
    const early = env({ now: T0 + 1000 })
    const busy = settle(reduceOffice(s, { type: 'session_prompt', sessionId: sid, project: 'x', cwd: '/x', text: 'next step' }, early).state, early)
    const waiting = busy.agents.find(a => a.id === lounger.id)!
    expect(waiting.state).toBe('waiting')
    expect(noDeskLabel(waiting)).toBe('waiting for a desk')

    // A minute later a desk changes hands: the lounger walks to it, an idle Claude goes to the lounge
    const later = env({ now: T0 + DESK_HANDOVER_IDLE_MS + 5000 })
    const swapped = settle(busy, later)
    const nowSeated = swapped.agents.find(a => a.id === lounger.id)!
    expect(nowSeated.assignedSpotId).toBeDefined()
    expect(nowSeated.state).toBe('working')
    const moved = swapped.agents.filter(a => a.id !== lounger.id && a.state === 'waiting')
    expect(moved).toHaveLength(1)
    expect(moved[0].assignedSpotId).toBeUndefined()
    expect(noDeskLabel(moved[0])).toBe('in the lounge')
    expect(swapped.lobby).toEqual([moved[0].id])
    // Nobody shares a desk
    const desks = swapped.agents.map(a => a.assignedSpotId).filter(Boolean)
    expect(new Set(desks).size).toBe(desks.length)
  })

  it('a worker with every desk taken by busy Claudes still waits by name ("waiting for a desk")', () => {
    let s = threads(DESKS - 1)
    for (let i = 1; i <= DESKS - 1; i++) s = reduceOffice(s, { type: 'session_prompt', ...S(i), text: 'go' }, env()).state
    s = settle(s)
    // fill the filing cabinet too, then a worker arrives
    s = settle(reduceOffice(s, { type: 'agent_spawned', agent: { id: 'ex', name: 'ex', role: 'Explore', task: 't' } }, env()).state)
    const r = reduceOffice(s, { type: 'agent_spawned', agent: { id: 'w1', name: 'w1', role: 'debugger', task: 't' } }, env({ now: T0 + DESK_HANDOVER_IDLE_MS * 2 }))
    const w = r.state.agents.find(a => a.id === 'w1')!
    expect(w.state).toBe('waiting')
    expect(noDeskLabel(w)).toBe('waiting for a desk')
    expect(w.targetPosition).toEqual(lobbyPosition(0))
  })
})
