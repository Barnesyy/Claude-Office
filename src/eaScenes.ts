/**
 * eaScenes.ts — the EA-development scenes' state on the page: what
 * server/ea-scenes.js broadcasts as `ea_state` (and the snapshot carries as
 * `ea`), kept in a tiny external store like taskBoard.ts, plus the pure
 * helpers the scene components use (the station's lights and words, the
 * cabinets' labels, which desks show MetaEditor / DAX / tester screens, the
 * risk badges, the balance curve, the whiteboard's modes and the Command
 * Centre's columns). Every number shown comes from the server, which only
 * reads it from a real tester report; nothing here estimates one.
 */

import { useSyncExternalStore } from 'react'
import type { Agent, OfficeEvent, SessionInfo } from './types'
import type { ScreenKind } from './screens'
import { isStaleNeedsYou, needsYouSince } from './mainState'

export type StationStatus =
  | 'idle' | 'running' | 'compiling' | 'awaiting-report' | 'done' | 'report-missing' | 'failed'
  | 'compile-ok' | 'compile-error' | 'compile-unknown'

export interface EaReport {
  /** Only on a trusted connection */
  path?: string
  name: string
  mtime: number
  netProfit: number | null
  maxDrawdown: number | null
  maxDrawdownPct: number | null
  drawdownKind: 'equity' | 'balance' | null
  trades: number | null
  initialDeposit?: number | null
  profitFactor?: number | null
  currency?: string | null
  expert?: string | null
  symbol?: string | null
  period?: string | null
}

export interface EaStation {
  status: StationStatus
  kind: 'backtest' | 'compile' | null
  label?: string
  startedAt?: number
  finishedAt?: number
  waitUntil?: number
  config?: { expert?: string | null; symbol?: string | null; period?: string | null; model?: number | null; modelName?: string | null; fromDate?: string | null; toDate?: string | null }
  report?: EaReport
  compile?: { errors: number | null; warnings: number | null; file: string; source: string | null }
  note?: string
  error?: string
  officeId?: string
}

export interface EaEquity extends EaReport {
  source: 'run' | 'folder'
  /** [time ms, balance] after each deal (thinned by the server) */
  points: Array<[number, number]>
  dealCount: number
}

export interface EaState {
  station: EaStation
  runs: Array<{ kind: 'backtest' | 'compile'; status: StationStatus; at: number; label: string; netProfit?: number | null; maxDrawdown?: number | null; maxDrawdownPct?: number | null; trades?: number | null; errors?: number | null; warnings?: number | null }>
  equity: EaEquity | null
  reportsDir: string | null
  cabinets: Array<{ year: number; lastAt: number; active: boolean }>
  screens: Array<{ sessionId?: string; agentId?: string; kind: 'mq5' | 'set' | 'tester'; file: string; at: number; officeId?: string }>
  risk: Array<{ id: string; sessionId?: string; agentId?: string; file: string; categories: string[]; terms: string[]; at: number; officeId?: string }>
  ticker: Array<{ at: number; text: string; tone: 'info' | 'good' | 'bad' | 'warn' }>
  now: number
}

export const EA_EMPTY: EaState = Object.freeze({
  station: { status: 'idle', kind: null }, runs: [], equity: null, reportsDir: null, cabinets: [], screens: [], risk: [], ticker: [], now: 0,
}) as EaState

/** The wire's state, checked field by field (a bad field becomes empty, never a guess). */
export function cleanEa(raw: unknown): EaState {
  if (!raw || typeof raw !== 'object') return EA_EMPTY
  const r = raw as Partial<EaState>
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  const station = r.station && typeof r.station === 'object' && typeof r.station.status === 'string' ? r.station : EA_EMPTY.station
  const equity = r.equity && typeof r.equity === 'object' && Array.isArray(r.equity.points)
    ? { ...r.equity, points: r.equity.points.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) }
    : null
  return {
    station,
    runs: arr(r.runs),
    equity,
    reportsDir: typeof r.reportsDir === 'string' ? r.reportsDir : null,
    cabinets: arr<EaState['cabinets'][number]>(r.cabinets).filter(c => c && Number.isInteger(c.year)),
    screens: arr<EaState['screens'][number]>(r.screens).filter(s => s && (s.kind === 'mq5' || s.kind === 'set' || s.kind === 'tester')),
    risk: arr<EaState['risk'][number]>(r.risk).filter(x => x && typeof x.id === 'string' && Array.isArray(x.categories)),
    ticker: arr<EaState['ticker'][number]>(r.ticker).filter(t => t && typeof t.text === 'string'),
    now: typeof r.now === 'number' ? r.now : 0,
  }
}

export function reduceEa(prev: EaState, event: OfficeEvent): EaState {
  if (event.type !== 'ea_state' || !event.ea) return prev
  return cleanEa(event.ea)
}

// ---------------------------------------------------------------------------
// Store (the taskBoard.ts pattern)
// ---------------------------------------------------------------------------

let state: EaState = EA_EMPTY
const listeners = new Set<() => void>()

export function getEa(): EaState { return state }
export function subscribeEa(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l) } }
export function useEa(): EaState { return useSyncExternalStore(subscribeEa, getEa, getEa) }
export function dispatchEa(event: OfficeEvent) {
  const next = reduceEa(state, event)
  if (next === state) return
  state = next
  for (const l of listeners) l()
}
export function resetEa() { state = EA_EMPTY; for (const l of listeners) l() }

// ---------------------------------------------------------------------------
// Words and numbers (a number the report lacks reads "—", never 0)
// ---------------------------------------------------------------------------

/** 1518.98 -> "+1,519"; -250.5 -> "−251"; under 100 keeps cents. null -> "—" */
export function money(n: number | null | undefined, { sign = true } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const body = abs >= 100 ? Math.round(abs).toLocaleString('en-AU') : abs.toFixed(2)
  return `${n < 0 ? '−' : sign && n > 0 ? '+' : ''}${body}`
}

export function pct(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '' : `${Math.round(n * 10) / 10}%`
}

/** The station's three lines of numbers, straight from the report; null when there is no report. */
export function reportLines(r: EaReport | undefined | null): { net: string; dd: string; trades: string; tone: 'good' | 'bad' | 'flat' } | null {
  if (!r) return null
  const dd = r.maxDrawdown === null ? '—' : `${money(r.maxDrawdown, { sign: false })}${r.maxDrawdownPct !== null ? ` (${pct(r.maxDrawdownPct)})` : ''}`
  return {
    net: money(r.netProfit),
    dd,
    trades: r.trades === null ? '—' : String(r.trades),
    tone: r.netProfit === null ? 'flat' : r.netProfit > 0 ? 'good' : r.netProfit < 0 ? 'bad' : 'flat',
  }
}

export type Lights = 'off' | 'run' | 'compile' | 'green' | 'red' | 'amber'

/** How the rack's LEDs look for a station state. */
export function stationLights(s: EaStation): Lights {
  switch (s.status) {
    case 'running': return 'run'
    case 'compiling': return 'compile'
    case 'done': case 'compile-ok': return 'green'
    case 'compile-error': case 'failed': return 'red'
    case 'awaiting-report': case 'report-missing': case 'compile-unknown': return 'amber'
    default: return 'off'
  }
}

/** The station's headline (what the readout card says on its first line). */
export function stationHeadline(s: EaStation): string {
  switch (s.status) {
    case 'running': return s.label ?? 'tester running'
    case 'compiling': return s.label ?? 'compiling'
    case 'awaiting-report': return 'waiting for the tester report'
    case 'done': return s.report ? `${s.report.expert ?? s.report.name}${s.report.symbol ? ` · ${s.report.symbol}` : ''}` : 'tester report'
    case 'report-missing': return 'report not found'
    case 'failed': return 'tester run failed'
    case 'compile-ok': return `${s.compile?.file ?? 'EA'} compiled`
    case 'compile-error': return `${s.compile?.file ?? 'EA'}: ${s.compile?.errors ?? '?'} error${s.compile?.errors === 1 ? '' : 's'}`
    case 'compile-unknown': return `${s.compile?.file ?? 'EA'}: result unknown`
    default: return 'backtest station idle'
  }
}

/** "0:42" for a run so far */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// ---------------------------------------------------------------------------
// The tick archive: one cabinet per year (ranges when there are many)
// ---------------------------------------------------------------------------

export interface Cabinet { label: string; years: number[]; active: boolean; lastAt: number }

/** The cabinets on the floor: a year each, or runs of years sharing one when more than `max`. */
export function cabinets(list: EaState['cabinets'], max = 5): Cabinet[] {
  const ys = [...list].sort((a, b) => a.year - b.year)
  if (!ys.length) return []
  const per = Math.ceil(ys.length / max)
  const out: Cabinet[] = []
  for (let i = 0; i < ys.length; i += per) {
    const chunk = ys.slice(i, i + per)
    const first = chunk[0].year
    const last = chunk[chunk.length - 1].year
    out.push({
      label: chunk.length === 1 ? String(first) : `${first}–${String(last).slice(2)}`,
      years: chunk.map(c => c.year),
      active: chunk.some(c => c.active),
      lastAt: Math.max(...chunk.map(c => c.lastAt)),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Desk screens and risk badges, by office worker id
// ---------------------------------------------------------------------------

const PAIRS: Record<'mq5' | 'set' | 'tester', readonly [ScreenKind, ScreenKind]> = {
  mq5: ['mql', 'dax'],
  set: ['tester', 'dax'],
  tester: ['tester', 'dax'],
}

/** What a worker who touched EA files has on its monitors (the newest touch wins). */
export function eaScreenPairs(ea: EaState): Record<string, readonly [ScreenKind, ScreenKind]> {
  const out: Record<string, readonly [ScreenKind, ScreenKind]> = {}
  const seen: Record<string, number> = {}
  for (const s of ea.screens) {
    if (!s.officeId || (seen[s.officeId] ?? -1) > s.at) continue
    seen[s.officeId] = s.at
    out[s.officeId] = PAIRS[s.kind]
  }
  // A worker running the tester right now shows it
  const st = ea.station
  if (st.officeId && st.status === 'running') out[st.officeId] = PAIRS.tester
  return out
}

/** The newest risk flag per office worker. */
export function riskByWorker(ea: EaState): Record<string, EaState['risk'][number]> {
  const out: Record<string, EaState['risk'][number]> = {}
  for (const r of ea.risk) if (r.officeId && (!out[r.officeId] || out[r.officeId].at <= r.at)) out[r.officeId] = r
  return out
}

/** The badge's tooltip: file, what it touched and a few of the identifiers. */
export function riskCaption(r: EaState['risk'][number]): string {
  return `Risk code edited in ${r.file}: ${r.categories.join(', ')}${r.terms.length ? ` (${r.terms.join(', ')})` : ''}. Info only — check it in a real-tick run.`
}

// ---------------------------------------------------------------------------
// The balance curve
// ---------------------------------------------------------------------------

/** An SVG path of the curve in a w × h box (y up), with its range; null with fewer than 2 points. */
export function curvePath(points: ReadonlyArray<readonly [number, number]>, w = 100, h = 60, pad = 3): { d: string; area: string; min: number; max: number; lastY: number } | null {
  if (points.length < 2) return null
  const t0 = points[0][0]
  const t1 = points[points.length - 1][0]
  let min = Infinity
  let max = -Infinity
  for (const [, v] of points) { if (v < min) min = v; if (v > max) max = v }
  const span = max - min || 1
  const x = (t: number, i: number) => pad + (t1 > t0 ? (t - t0) / (t1 - t0) : i / (points.length - 1)) * (w - 2 * pad)
  const y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad)
  const xy = points.map(([t, v], i) => `${x(t, i).toFixed(2)},${y(v).toFixed(2)}`)
  const d = `M ${xy.join(' L ')}`
  const area = `${d} L ${(w - pad).toFixed(2)},${h - pad} L ${pad},${h - pad} Z`
  return { d, area, min, max, lastY: y(points[points.length - 1][1]) }
}

// ---------------------------------------------------------------------------
// The whiteboard's modes
// ---------------------------------------------------------------------------

export type WallMode = 'todo' | 'kanban' | 'equity' | 'ticker'
export const WALL_MODES: readonly WallMode[] = ['todo', 'kanban', 'equity', 'ticker']
export const WALL_TITLES: Record<WallMode, string> = { todo: 'To-do', kanban: 'Kanban', equity: 'Balance curve', ticker: 'EA ticker' }
/** How long each mode stays up while cycling */
export const WALL_CYCLE_MS = 12_000

/** The modes worth cycling through: the ones with something to show. */
export function wallModesWithContent(hasTasks: boolean, ea: EaState): WallMode[] {
  return WALL_MODES.filter(m => (m === 'todo' || m === 'kanban' ? hasTasks : m === 'equity' ? !!ea.equity : ea.ticker.length > 0))
}

/**
 * The mode on the wall: the picked one (a tab click), else the cycle's turn
 * among the modes with content; null when nothing has content (the art's own
 * board shows).
 */
export function wallMode(picked: WallMode | null, withContent: readonly WallMode[], turn: number): WallMode | null {
  if (picked) return picked
  if (!withContent.length) return null
  return withContent[((turn % withContent.length) + withContent.length) % withContent.length]
}

// ---------------------------------------------------------------------------
// The Command Centre (paulrobello/claude-office's columns)
// ---------------------------------------------------------------------------

export type CentreColumn = 'needs-you' | 'working' | 'done' | 'stale' | 'ended'
export const CENTRE_COLUMNS: ReadonlyArray<{ id: CentreColumn; title: string }> = [
  { id: 'needs-you', title: 'Needs you' }, { id: 'working', title: 'Working' }, { id: 'done', title: 'Done' }, { id: 'stale', title: 'Stale >6h' }, { id: 'ended', title: 'Ended' },
]

export interface CentreCard {
  id: string
  title: string
  project?: string
  column: CentreColumn
  /** What it is doing or waiting on, in a line */
  line: string
  since?: number
  workers: number
}

/** Which column a session belongs in, from its main-thread record and the registry. */
export function centreColumn(s: SessionInfo, now = Date.now()): CentreColumn {
  if (s.state === 'ended') return 'ended'
  const main = s.main?.state
  if (main === 'needs-you' || main === 'error' || s.registry?.status === 'waiting') {
    // A hand up for over 6 h is an old terminal at a dialog, not today's work
    if (main !== 'error' && isStaleNeedsYou(s, now)) return 'stale'
    return 'needs-you'
  }
  if (main === 'working' || main === 'waiting' || main === 'compacting' || s.registry?.status === 'busy' || s.registry?.status === 'shell') return 'working'
  return 'done'
}

function centreLine(s: SessionInfo, column: CentreColumn): string {
  if (column === 'needs-you' || column === 'stale') {
    const n = s.main?.needsYou
    if (s.main?.state === 'error') return `error: ${s.main.error?.error ?? 'API error'}`
    if (n?.kind === 'permission' || n?.toolName) return `permission: ${n?.summary ?? n?.toolName ?? 'a tool'}`
    return n?.message ?? n?.summary ?? 'waiting on you'
  }
  if (column === 'working') return s.lastStatus ?? s.main?.lastPrompt ?? 'working'
  if (column === 'ended') return s.reason ? `ended: ${s.reason}` : 'ended'
  return s.main?.lastReply ?? s.main?.lastPrompt ?? 'idle'
}

/** Every session as a card in its column, newest activity first. */
export function centreCards(sessions: readonly SessionInfo[], agents: readonly Agent[] = [], now = Date.now()): Record<CentreColumn, CentreCard[]> {
  const out: Record<CentreColumn, CentreCard[]> = { 'needs-you': [], working: [], done: [], stale: [], ended: [] }
  const sorted = [...sessions].sort((a, b) => (b.lastActivityAt ?? b.startedAt ?? 0) - (a.lastActivityAt ?? a.startedAt ?? 0))
  for (const s of sorted) {
    const column = centreColumn(s, now)
    out[column].push({
      id: s.id,
      title: s.title || s.registry?.name || s.project || s.id.slice(0, 8),
      project: s.project,
      column,
      line: centreLine(s, column).replace(/\s+/g, ' ').slice(0, 120),
      since: column === 'needs-you' || column === 'stale' ? needsYouSince(s) : s.main?.since ?? s.lastActivityAt ?? s.startedAt,
      workers: agents.filter(a => a.sessionId === s.id && !a.id.startsWith('main-')).length,
    })
  }
  return out
}
