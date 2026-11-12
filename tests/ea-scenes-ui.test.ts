/**
 * src/eaScenes.ts — the EA scenes' store and words — and their components
 * rendered to static markup (no DOM): the station's card says the report's
 * numbers or "report not found" and never a number of its own, the rack's
 * lights follow the state, cabinets group years, EA screens go on the right
 * desk, risk flags float over desks, the whiteboard cycles its modes, the
 * Command Centre sorts sessions into its four columns.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import EaScene from '../src/components/EaScene'
import WallBoard from '../src/components/WallBoard'
import CommandCentre from '../src/components/CommandCentre'
import {
  EA_EMPTY, cabinets, centreCards, centreColumn, cleanEa, curvePath, dispatchEa, eaScreenPairs, getEa, money, reportLines,
  resetEa, riskByWorker, equityCaption, queueLines, choiceLabel, stationHeadline, stationLights, wallMode, wallModesWithContent, type EaState,
} from '../src/eaScenes'
import { deskScreens } from '../src/screens'
import type { Agent, SessionInfo } from '../src/types'

afterEach(() => resetEa())

const REPORT = { name: 'ReportTester-SchoolRun_FIXTURE.htm', mtime: 1, netProfit: 1518.98, maxDrawdown: 1029.97, maxDrawdownPct: 8.63, drawdownKind: 'equity' as const, trades: 96, expert: 'SchoolRun_FIXTURE', symbol: 'GER40' }

function state(over: Partial<EaState> = {}): EaState {
  return { ...EA_EMPTY, ...over }
}

function worker(id: string, over: Partial<Agent> = {}): Agent {
  const at = { x: 37.9, y: 68.2 }
  return {
    id, name: id, type: 'subagent', role: 'general-purpose', state: 'working', position: at, targetPosition: at, deskPosition: at,
    room: 'main', assignedRoom: 'main', assignedSpotId: 'spot-2', color: '#fff', emoji: '', hiredAt: 0, ...over,
  } as Agent
}

describe('words and numbers', () => {
  it("the station's numbers are the report's; a missing one reads —, never 0", () => {
    expect(reportLines(REPORT)).toEqual({ net: '+1,519', dd: '1,030 (8.6%)', trades: '96', tone: 'good' })
    expect(reportLines({ ...REPORT, netProfit: -42.5, maxDrawdown: null, trades: null })).toEqual({ net: '−42.50', dd: '—', trades: '—', tone: 'bad' })
    expect(reportLines(undefined)).toBeNull()
    expect(money(null)).toBe('—')
    expect(money(0)).toBe('0.00')
  })

  it('lights and headlines per station state', () => {
    expect(stationLights({ status: 'running', kind: 'backtest' })).toBe('run')
    expect(stationLights({ status: 'compile-error', kind: 'compile' })).toBe('red')
    expect(stationLights({ status: 'report-missing', kind: 'backtest' })).toBe('amber')
    expect(stationLights({ status: 'done', kind: 'backtest' })).toBe('green')
    expect(stationLights({ status: 'idle', kind: null })).toBe('off')
    expect(stationHeadline({ status: 'done', kind: 'backtest', report: REPORT })).toBe('SchoolRun_FIXTURE · GER40')
    expect(stationHeadline({ status: 'report-missing', kind: 'backtest' })).toBe('report not found')
    expect(stationHeadline({ status: 'compile-error', kind: 'compile', compile: { errors: 1, warnings: 0, file: 'X.mq5', source: 'log' } })).toBe('X.mq5: 1 error')
  })

  it('the wire is checked: junk becomes empty, not a guess', () => {
    expect(cleanEa(null)).toBe(EA_EMPTY)
    const c = cleanEa({ station: { status: 'done', kind: 'backtest' }, equity: { points: [[1, 2], ['x', 3], [2, 5]] }, cabinets: [{ year: 2020 }, { year: 'x' }], screens: [{ kind: 'pdf' }] })
    expect(c.equity?.points).toEqual([[1, 2], [2, 5]])
    expect(c.cabinets).toHaveLength(1)
    expect(c.screens).toEqual([])
    dispatchEa({ type: 'ea_state', ea: { station: { status: 'running', kind: 'backtest' } } })
    expect(getEa().station.status).toBe('running')
    dispatchEa({ type: 'task_board' })
    expect(getEa().station.status).toBe('running')
  })

  it('cabinets: one per year, runs of years when there are more than fit', () => {
    const ys = (from: number, to: number, active: number[] = []) => Array.from({ length: to - from + 1 }, (_, i) => ({ year: from + i, lastAt: i, active: active.includes(from + i) }))
    expect(cabinets(ys(2021, 2023)).map(c => c.label)).toEqual(['2021', '2022', '2023'])
    const many = cabinets(ys(2013, 2023, [2016]), 3)
    expect(many.map(c => c.label)).toEqual(['2013–16', '2017–20', '2021–23'])
    expect(many.map(c => c.active)).toEqual([true, false, false])
  })

  it('the balance curve fits its box, y up', () => {
    const c = curvePath([[0, 100], [1, 50], [2, 150]], 100, 60, 0)!
    expect(c.d).toBe('M 0.00,30.00 L 50.00,60.00 L 100.00,0.00')
    expect([c.min, c.max]).toEqual([50, 150])
    expect(curvePath([[0, 1]])).toBeNull()
  })
})

describe('screens and flags', () => {
  it('a worker on a .mq5 gets MetaEditor and DAX up while busy; idle it shows the idle screens', () => {
    const ea = state({ screens: [{ kind: 'mq5', file: 'X.mq5', at: 1, officeId: 'w1' }, { kind: 'set', file: 'X.set', at: 2, officeId: 'w2' }] })
    const pairs = eaScreenPairs(ea)
    expect(pairs).toEqual({ w1: ['mql', 'dax'], w2: ['tester', 'dax'] })
    const desks = deskScreens([worker('w1')], new Set(), pairs)
    expect(desks['desk-2b']).toEqual(['mql', 'dax'])
    expect(deskScreens([worker('w1', { state: 'idle' })], new Set(), pairs)['desk-2b']).toEqual(['idle', 'idle'])
    // A failure still wins
    expect(deskScreens([worker('w1', { lastFailed: true })], new Set(), pairs)['desk-2b']).toEqual(['bug', 'bug'])
    // The worker running the tester shows it
    expect(eaScreenPairs(state({ station: { status: 'running', kind: 'backtest', officeId: 'w3' } }))).toEqual({ w3: ['tester', 'dax'] })
  })

  it('the newest risk flag per worker', () => {
    const r = (id: string, at: number, officeId?: string) => ({ id, file: 'X.mq5', categories: ['risk'], terms: [], at, officeId })
    expect(Object.keys(riskByWorker(state({ risk: [r('a', 1, 'w1'), r('b', 2, 'w1'), r('c', 3)] })))).toEqual(['w1'])
    expect(riskByWorker(state({ risk: [r('a', 1, 'w1'), r('b', 2, 'w1')] })).w1.id).toBe('b')
  })
})

describe('the scene, rendered', () => {
  it('idle: the station stands dark with no card, no cabinets, no flags', () => {
    const html = renderToStaticMarkup(createElement(EaScene, { agents: [] }))
    expect(html).toContain('server-rack-1')
    expect(html).not.toContain('ea-station-card')
    expect(html).not.toContain('ea-rack-leds')
    expect(html).not.toContain('ea-cabinet')
  })

  it('done: the card carries the report numbers; report missing says so with no numbers', () => {
    dispatchEa({ type: 'ea_state', ea: { ...EA_EMPTY, station: { status: 'done', kind: 'backtest', report: REPORT } } })
    let html = renderToStaticMarkup(createElement(EaScene, { agents: [] }))
    expect(html).toContain('Net +1,519')
    expect(html).toContain('DD 1,030 (8.6%)')
    expect(html).toContain('96 trades')
    expect(html).toContain('ea-rack-leds')
    dispatchEa({ type: 'ea_state', ea: { ...EA_EMPTY, station: { status: 'report-missing', kind: 'backtest', note: 'report not found: no report at R.htm' } } })
    html = renderToStaticMarkup(createElement(EaScene, { agents: [] }))
    expect(html).toContain('report not found')
    expect(html).toContain('no report at R.htm')
    expect(html).not.toMatch(/Net [+−\d]/)
  })

  it('cabinets get year plates; a risk flag floats over its worker', () => {
    dispatchEa({ type: 'ea_state', ea: { ...EA_EMPTY, cabinets: [{ year: 2019, lastAt: 1, active: true }, { year: 2020, lastAt: 1, active: false }], risk: [{ id: 'r1', file: 'X.mq5', categories: ['lot sizing', 'stop-loss'], terms: ['lots'], at: 1, officeId: 'w1' }] } })
    const html = renderToStaticMarkup(createElement(EaScene, { agents: [worker('w1')] }))
    expect(html).toContain('>2019</div>')
    expect(html).toContain('filling-open')
    expect(html).toContain('ea-risk-badge')
    expect(html).toContain('LOTS·SL')
    expect(html).toContain('Info only')
  })
})

describe('whiteboard modes', () => {
  it('cycles only the modes with content; a picked mode holds; nothing to show draws only the tabs', () => {
    const withEq = state({ equity: { ...REPORT, source: 'run', points: [[0, 1], [1, 2]], dealCount: 2 } })
    expect(wallModesWithContent(false, EA_EMPTY)).toEqual([])
    expect(wallModesWithContent(true, withEq)).toEqual(['todo', 'kanban', 'equity'])
    expect(wallMode(null, ['todo', 'kanban', 'equity'], 4)).toBe('kanban')
    expect(wallMode('ticker', ['todo'], 0)).toBe('ticker')
    expect(wallMode(null, [], 3)).toBeNull()
    const html = renderToStaticMarkup(createElement(WallBoard, { sessions: [], night: 0 }))
    expect(html).toContain('wall-tab-equity')
    expect(html).not.toContain('task-board-surface')
  })

  it('the balance curve mode draws the report curve and its numbers', () => {
    dispatchEa({ type: 'ea_state', ea: { ...EA_EMPTY, equity: { ...REPORT, source: 'run', points: [[0, 10000], [1, 10500], [2, 11518.98]], dealCount: 3 } } })
    const html = renderToStaticMarkup(createElement(WallBoard, { sessions: [], night: 0 }))
    expect(html).toContain('wall-curve')
    expect(html).toContain('+1,519')
    expect(html).toContain('96t')
  })
})

describe('equity caption, picker and queue lines', () => {
  it('captions a curve with EA, symbol, timeframe and dates; lists the queue', () => {
    expect(equityCaption({ expert: 'BrooksSetupTesterDAX_v024', name: 'x.htm', symbol: 'DAX40', period: 'M5 (2013.01.01 - 2013.12.31)', timeframe: 'M5', from: '2013.01.01', to: '2013.12.31' }))
      .toBe('BrooksSetupTesterDAX_v024 · DAX40 · M5 · 2013.01.01–2013.12.31')
    expect(queueLines({ armed: true, queued: 2, running: [{ id: 'Q', test: 'R1781', install: 'BlackBull tester', completed: 0, planned: 4, run: 'GO139B1_FRAC' }],
      installs: [{ name: 'BlackBull tester', running: 'R1781', queued: 2, held: null }], latest: null }))
      .toEqual(['▶ BlackBull tester: R1781 0/4 · GO139B1_FRAC', '2 queued · BlackBull tester 2'])
    expect(queueLines(null)).toEqual([])
  })
  it('the station card shows a Workbench run and its queue', () => {
    dispatchEa({ type: 'ea_state', ea: { ...EA_EMPTY, station: { status: 'running', kind: 'backtest', source: 'workbench', label: 'Workbench R1781 on BlackBull tester · 0/4',
      queue: { armed: true, queued: 1, running: [{ id: 'Q', test: 'R1781', install: 'BlackBull tester', completed: 0, planned: 4 }], installs: [{ name: 'BlackBull tester', running: 'R1781', queued: 1, held: null }], latest: null } } } })
    const html = renderToStaticMarkup(createElement(EaScene, { agents: [] }))
    expect(html).toContain('data-source="workbench"')
    expect(html).toContain('Workbench R1781 on BlackBull tester')
    expect(html).toContain('1 queued')
  })
  it('the wall shows its caption and AUTO / PINNED tag', () => {
    dispatchEa({ type: 'ea_state', ea: { ...EA_EMPTY, equity: { ...REPORT, source: 'focus', pick: 'auto', focus: 'SchoolRun', timeframe: 'M15', from: '2019.01.02', to: '2023.12.29', points: [[0, 1], [1, 2]], dealCount: 2 } } })
    const html = renderToStaticMarkup(createElement(WallBoard, { sessions: [], night: 0 }))
    expect(html).toContain('2019.01.02–2023.12.29')
    expect(html).toContain('AUTO · SchoolRun')
  })
})

describe('Command Centre', () => {
  const s = (id: string, over: Partial<SessionInfo>): SessionInfo => ({ id, state: 'active', project: id, ...over })
  it('needs you, working, done, ended', () => {
    expect(centreColumn(s('a', { main: { state: 'needs-you', needsYou: { kind: 'permission', toolName: 'Bash' } } }))).toBe('needs-you')
    expect(centreColumn(s('b', { main: { state: 'error' } }))).toBe('needs-you')
    expect(centreColumn(s('c', { main: { state: 'working' } }))).toBe('working')
    expect(centreColumn(s('d', { main: { state: 'idle' } }))).toBe('done')
    expect(centreColumn(s('e', { state: 'ended', reason: 'logout' }))).toBe('ended')
    expect(centreColumn(s('f', { registry: { pid: 1, status: 'waiting' } }))).toBe('needs-you')
    const cols = centreCards([s('a', { main: { state: 'needs-you', needsYou: { kind: 'permission', toolName: 'Bash' } } }), s('c', { main: { state: 'working' }, lastStatus: 'running tests' })],
      [worker('w1', { sessionId: 'c' })])
    expect(cols['needs-you'][0].line).toBe('permission: Bash')
    expect(cols.working[0]).toMatchObject({ line: 'running tests', workers: 1 })
    const html = renderToStaticMarkup(createElement(CommandCentre, { sessions: [s('c', { main: { state: 'working' } })], agents: [], onClose() {} }))
    for (const t of ['Needs you', 'Working', 'Done', 'Stale &gt;6h', 'Ended']) expect(html).toContain(t)
  })
  it('a terminal waiting for over 6 h goes to Stale, with its age', () => {
    const now = Date.now()
    const old = s('g', { hooked: false, registry: { pid: 2, status: 'waiting' }, main: { state: 'needs-you', needsYou: { kind: 'registry', summary: 'waiting in the terminal', since: now - 20 * 3600_000 } } })
    expect(centreColumn(old, now)).toBe('stale')
    expect(centreColumn({ ...old, main: { ...old.main!, needsYou: { ...old.main!.needsYou!, since: now - 60_000 } } }, now)).toBe('needs-you')
    const cols = centreCards([old], [], now)
    expect(cols.stale[0]).toMatchObject({ id: 'g', since: now - 20 * 3600_000 })
  })
})

describe('equity picker labels', () => {
  it('names the file and tester folder, folded copies, and marks the EA being worked on', () => {
    const t = new Date(2026, 10, 12, 17, 36).getTime()
    expect(choiceLabel({ name: 'R1802.htm', expert: 'BPASDR16Twin', symbol: 'NAS_BB13', period: 'M5 (2019.01.01 - 2026.09.01)', mtime: t, netProfit: 1, file: 'R1802.htm', folder: 'BlackBull tester 2', also: 1, focus: true }))
      .toBe('◆ BPASDR16Twin · NAS_BB13 · M5 (2019.01.01 - 2026.09.01) · 17:36 — R1802.htm in BlackBull tester 2 (+1 copy)')
    expect(choiceLabel({ name: 'a.htm', expert: null, symbol: null, period: null, mtime: t, netProfit: null }))
      .toBe('a.htm · 17:36')
  })
})
