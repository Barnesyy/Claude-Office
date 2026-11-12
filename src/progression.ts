/**
 * progression.ts - the page's side of the progression layer
 * (server/progression.js): the book from GET /progression, kept fresh by the
 * server's progression_* broadcasts, plus what the room and the panel draw
 * from it.
 *
 *   loadProgression()        GET /progression (once per page, again on reset / reconnect)
 *   dispatchProgression(e)   progression_update | progression_award | progression_reset | progression_settings
 *   useProgression()         the store, re-rendering on change
 *   openProgressionPanel()   the status strip button and the mailbox both open it
 *
 * Everything that decides what to draw is a pure function below (cabinetTrophies,
 * gardenPlants, parcelsShown, xpProgress, ...) so the tests can call it.
 */

import { useSyncExternalStore } from 'react'
import { officeHttpBase } from './serverUrl'
import { officeAuthHeaders } from './officeAuth'
import { getUiToken } from './permissions'
import { onPhoneFullPage } from './phoneSecret'
import art from './progressionArt.json'

export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum'
export const TIERS: Tier[] = ['bronze', 'silver', 'gold', 'platinum']

export interface Award {
  id: string
  type: 'level' | 'trophy' | 'milestone' | 'unlock'
  title: string
  tier?: Tier | null
  detail?: string | null
  rare?: boolean
  at: number
}

export interface Track {
  id: string
  title: string
  count: number
  tiers: { tier: Tier; threshold: number; earned: boolean; at: number | null }[]
}

export interface Unlock { id: string; title: string; detail: string; hint: string; rare: boolean; unlocked: boolean; at: number | null }
export interface Milestone { id: string; title: string; detail: string; earned: boolean; at: number | null }
export interface Lesson { id: number; label: string; fails: number; ms: number; at: number; date: string }
export interface Plant { key: string; repo: string | null; pr: number | null; seed: number; at: number }

export interface ProgressionTotals {
  xp: number
  level: number
  title: string
  levelFloor: number
  nextLevelXp: number
  todayXp: number
  streak: number
}

export interface ProgressionSnapshot extends ProgressionTotals {
  enabled: boolean
  counts: Record<string, number>
  tracks: Track[]
  milestones: Milestone[]
  unlocks: Unlock[]
  awards: Award[]
  lessons: Lesson[]
  garden: { total: number; plants: Plant[] }
  shipped: number
  equity: { high: number | null; at?: number; readings: number }
  recent: { at: number; kind: string; xp: number; label: string | null }[]
}

export interface DayReport {
  date: string
  today?: boolean
  xp: number
  kinds: Record<string, { count: number; xp: number }>
  awards: Award[]
  lessons: Lesson[]
  recap: Record<string, number | string> | null
}

export interface QuarterReport {
  quarter: string
  from: string
  to: string
  xp: number
  activeDays: number
  bestDay: { date: string; xp: number } | null
  kinds: Record<string, { count: number; xp: number }>
  byMonth: Record<string, number>
  greenRate: number | null
  awards: Award[]
  lessons: number
  topLessons: { label: string; n: number }[]
}

export type ProgressionEvent =
  | ({ type: 'progression_update'; gain?: { kind: string; xp: number; label?: string }; timestamp?: number } & Partial<ProgressionTotals>)
  | { type: 'progression_award'; award: Award; timestamp?: number }
  | { type: 'progression_reset'; timestamp?: number }
  | { type: 'progression_settings'; enabled: boolean; timestamp?: number }

export type PanelTab = 'office' | 'trophies' | 'unlocks' | 'lessons' | 'today' | 'quarter'

export interface ProgressionState {
  snapshot: ProgressionSnapshot | null
  /** Awards waiting to be shown as a toast (oldest first) */
  toasts: Award[]
  /** An unlock playing its reveal: the dust sheet lifts, stars burst */
  reveals: { id: string; at: number }[]
  /** The last XP gain, for the +XP float over the cabinet */
  lastGain: { kind: string; xp: number; label?: string; at: number } | null
  panel: PanelTab | null
  /** Awards newer than this have not been seen in the panel (the mailbox flag) */
  seenAt: number
}

const SEEN_KEY = 'agent-office.progression.seenAt'

function readSeen(): number {
  try { return Number(localStorage.getItem(SEEN_KEY)) || 0 } catch { return 0 }
}

let state: ProgressionState = { snapshot: null, toasts: [], reveals: [], lastGain: null, panel: null, seenAt: typeof localStorage === 'undefined' ? 0 : readSeen() }
const listeners = new Set<() => void>()

function set(next: ProgressionState) {
  state = next
  listeners.forEach(l => l())
}

export function getProgressionState(): ProgressionState { return state }

/** For tests: start over */
export function resetProgressionStore(next: Partial<ProgressionState> = {}) {
  state = { snapshot: null, toasts: [], reveals: [], lastGain: null, panel: null, seenAt: 0, ...next }
}

// ---------------------------------------------------------------------------
// The pure transition
// ---------------------------------------------------------------------------

/** A broadcast applied to the store (without the fetch a reset asks for). */
export function applyProgressionEvent(s: ProgressionState, e: ProgressionEvent, now = Date.now()): ProgressionState {
  switch (e.type) {
    case 'progression_update': {
      const snap = s.snapshot
      const totals: Partial<ProgressionTotals> = {}
      for (const k of ['xp', 'level', 'title', 'levelFloor', 'nextLevelXp', 'todayXp', 'streak'] as const) {
        if (e[k] !== undefined) (totals as Record<string, unknown>)[k] = e[k]
      }
      return {
        ...s,
        snapshot: snap ? { ...snap, ...totals, counts: e.gain ? { ...snap.counts, [e.gain.kind]: (snap.counts[e.gain.kind] ?? 0) + 1 } : snap.counts } : snap,
        lastGain: e.gain && e.gain.xp > 0 ? { ...e.gain, at: now } : s.lastGain,
      }
    }
    case 'progression_award': {
      const a = e.award
      if (!a?.id) return s
      const snap = s.snapshot
      let next = snap
      if (snap && !snap.awards.some(x => x.id === a.id)) {
        next = { ...snap, awards: [...snap.awards, a].slice(-60) }
        if (a.type === 'unlock') {
          const id = a.id.replace(/^unlock:/, '')
          next.unlocks = snap.unlocks.map(u => (u.id === id ? { ...u, title: a.title, detail: a.detail ?? u.detail, unlocked: true, at: a.at } : u))
        } else if (a.type === 'trophy') {
          const [, track, tier] = a.id.split(':')
          next.tracks = snap.tracks.map(t => (t.id === track ? { ...t, tiers: t.tiers.map(x => (x.tier === tier ? { ...x, earned: true, at: a.at } : x)) } : t))
        } else if (a.type === 'milestone') {
          const id = a.id.replace(/^milestone:/, '')
          next.milestones = snap.milestones.map(m => (m.id === id ? { ...m, earned: true, at: a.at } : m))
        }
      }
      return {
        ...s,
        snapshot: next,
        toasts: [...s.toasts, a].slice(-6),
        reveals: a.type === 'unlock' ? [...s.reveals.filter(r => now - r.at < REVEAL_MS), { id: a.id.replace(/^unlock:/, ''), at: now }] : s.reveals,
      }
    }
    case 'progression_settings':
      return { ...s, snapshot: s.snapshot ? { ...s.snapshot, enabled: e.enabled } : s.snapshot }
    case 'progression_reset':
      return { ...s, toasts: [], reveals: [], lastGain: null }
    default:
      return s
  }
}

export const REVEAL_MS = 2600
export const TOAST_MS = 4200

// ---------------------------------------------------------------------------
// Server calls
// ---------------------------------------------------------------------------

let loading: Promise<void> | null = null

/** GET /progression; `force` refetches (after a reset, a reconnect). */
export function loadProgression(force = false): Promise<void> {
  // Loopback only (server/lan.js): a phone on the LAN shows no progression
  if (onPhoneFullPage()) return Promise.resolve()
  if (loading && !force) return loading
  loading = fetch(`${officeHttpBase()}/progression`, { signal: AbortSignal.timeout(4000), headers: officeAuthHeaders() })
    .then(r => (r.ok ? r.json() : null))
    .then((snap: ProgressionSnapshot | null) => { if (snap && typeof snap.xp === 'number') set({ ...state, snapshot: snap }) })
    .catch(() => {})
  return loading
}

let settleTimer: ReturnType<typeof setTimeout> | null = null
/** The live events carry totals and awards; the garden, the bin, the binder and the log come with the snapshot,
 *  so a burst of activity is followed by one quiet refetch. */
const SETTLE_MS = 1500

export function dispatchProgression(e: ProgressionEvent) {
  set(applyProgressionEvent(state, e))
  if (e.type === 'progression_reset' || (e.type === 'progression_settings' && e.enabled)) { void loadProgression(true); return }
  if (e.type === 'progression_update' || e.type === 'progression_award') {
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => { settleTimer = null; void loadProgression(true) }, SETTLE_MS)
  }
}

/** Drop a toast that has had its time. */
export function dismissToast(id: string) {
  set({ ...state, toasts: state.toasts.filter(t => t.id !== id) })
}

export function openProgressionPanel(tab: PanelTab = 'office') {
  const seenAt = Date.now()
  try { localStorage.setItem(SEEN_KEY, String(seenAt)) } catch {}
  set({ ...state, panel: tab, seenAt })
  void loadProgression(true)
}

export function closeProgressionPanel() { set({ ...state, panel: null }) }

async function postUi(path: string, body: unknown): Promise<boolean> {
  if (onPhoneFullPage()) return false
  const token = getUiToken()
  if (!token) return false
  try {
    const res = await fetch(`${officeHttpBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch { return false }
}

export async function setProgressionEnabled(on: boolean): Promise<boolean> {
  const before = state.snapshot
  if (before) set({ ...state, snapshot: { ...before, enabled: on } })
  const ok = await postUi('/progression/settings', { enabled: on })
  if (!ok && before) set({ ...state, snapshot: before })
  return ok
}

export async function resetProgression(): Promise<boolean> {
  const ok = await postUi('/progression/reset', { confirm: 'reset' })
  if (ok) await loadProgression(true)
  return ok
}

export async function fetchDay(date?: string): Promise<DayReport | null> {
  if (onPhoneFullPage()) return null
  try {
    const r = await fetch(`${officeHttpBase()}/progression/day${date ? `?date=${encodeURIComponent(date)}` : ''}`, { headers: officeAuthHeaders(), signal: AbortSignal.timeout(4000) })
    return r.ok ? await r.json() : null
  } catch { return null }
}

export async function fetchQuarter(q?: string): Promise<QuarterReport | null> {
  if (onPhoneFullPage()) return null
  try {
    const r = await fetch(`${officeHttpBase()}/progression/quarter${q ? `?q=${encodeURIComponent(q)}` : ''}`, { headers: officeAuthHeaders(), signal: AbortSignal.timeout(4000) })
    return r.ok ? await r.json() : null
  } catch { return null }
}

export function useProgression(): ProgressionState {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => state,
    () => state,
  )
}

// ---------------------------------------------------------------------------
// What the room draws (pure)
// ---------------------------------------------------------------------------

export const SPRITES = {
  cabinet: '/sprites/progression/trophy-cabinet.png',
  mailboxUp: '/sprites/progression/mailbox-up.png',
  mailboxDown: '/sprites/progression/mailbox-down.png',
  bin: '/sprites/progression/shipped-bin.png',
  parcel: '/sprites/progression/parcel.png',
  planter: '/sprites/progression/planter.png',
  binder: '/sprites/progression/lessons-binder.png',
  padlock: '/sprites/progression/padlock.png',
  medal: '/sprites/progression/medal.png',
  crown: '/sprites/progression/crown.png',
  clover: '/sprites/progression/clover.png',
  gem: '/sprites/progression/gem.png',
  // Upstream's own MIT sprites, and the fork's Trading Floor props
  rack: '/sprites/rooms/server-rack-2.webp',
  moneyTree: '/sprites/decoration/money-tree.png',
  equity: '/sprites/trading/props/equity-curve-frame.png',
  bull: '/sprites/trading/props/bull-trophy.png',
  star: '/sprites/effects/star.png',
  party: '/sprites/effects/party.png',
} as const

export const TROPHY_SPRITES: Record<Tier, string> = {
  bronze: '/sprites/progression/trophy-bronze.png',
  silver: '/sprites/progression/trophy-silver.png',
  gold: '/sprites/progression/trophy-gold.png',
  platinum: '/sprites/progression/trophy-platinum.png',
}

export const PLANT_SPRITES = [
  '/sprites/progression/plant-0.png',
  '/sprites/progression/plant-1.png',
  '/sprites/progression/plant-2.png',
  '/sprites/progression/plant-3.png',
] as const

export const SHEET_SPRITES = {
  small: '/sprites/progression/dust-sheet-small.png',
  medium: '/sprites/progression/dust-sheet-medium.png',
  tall: '/sprites/progression/dust-sheet-tall.png',
  long: '/sprites/progression/dust-sheet-long.png',
} as const

type ArtMeta = { w: number; h: number; shelves?: { x: number; y: number }[][]; slots?: { x: number; y: number }[]; pile?: { x: number; y: number } }
const ART = (art as { sprites: Record<string, ArtMeta> }).sprites

/** A sprite's art size (1 art pixel = 1 CSS pixel, the upstream furniture's density). */
export function artSize(path: string): { w: number; h: number } {
  const m = ART[path.split('/').pop() ?? '']
  return m ? { w: m.w, h: m.h } : { w: 32, h: 32 }
}

export const CABINET_SHELVES = ART['trophy-cabinet.png']?.shelves ?? []
export const PLANTER_SLOTS = ART['planter.png']?.slots ?? []
export const BIN_PILE = ART['shipped-bin.png']?.pile ?? { x: 50, y: 50 }

/**
 * The trophies on the cabinet: each track's best earned tier, best first
 * (platinum, gold, ...; then the newer), at most one per shelf slot.
 */
export function cabinetTrophies(tracks: Track[] | undefined, slots = CABINET_SHELVES.flat().length): { track: string; title: string; tier: Tier; at: number }[] {
  const out: { track: string; title: string; tier: Tier; at: number }[] = []
  for (const t of tracks ?? []) {
    const earned = t.tiers.filter(x => x.earned)
    if (!earned.length) continue
    const best = earned[earned.length - 1]
    out.push({ track: t.id, title: t.title, tier: best.tier, at: best.at ?? 0 })
  }
  out.sort((a, b) => TIERS.indexOf(b.tier) - TIERS.indexOf(a.tier) || b.at - a.at)
  return out.slice(0, slots)
}

/** The window box's plants: newest PRs, one per slot, each its own look from its seed. */
export function gardenPlants(plants: Plant[] | undefined, slots = PLANTER_SLOTS.length): { key: string; sprite: string; slot: number; label: string }[] {
  const list = (plants ?? []).slice(0, slots).reverse() // oldest of those shown at the back
  return list.map((p, i) => ({
    key: p.key,
    sprite: PLANT_SPRITES[p.seed % PLANT_SPRITES.length],
    slot: i,
    label: p.pr !== null ? `PR #${p.pr}${p.repo ? ` · ${p.repo}` : ''}` : 'a merged PR',
  }))
}

/** How many parcels to pile in the Shipped bin (the count itself is on its tag). */
export function parcelsShown(shipped: number): number {
  return Math.max(0, Math.min(6, shipped))
}

/** 0..1 through the current level. */
export function xpProgress(t: Pick<ProgressionTotals, 'xp' | 'levelFloor' | 'nextLevelXp'>): number {
  const span = t.nextLevelXp - t.levelFloor
  if (span <= 0) return 1
  return Math.max(0, Math.min(1, (t.xp - t.levelFloor) / span))
}

/** Unseen news: an award newer than the last time the panel was opened. */
export function hasNews(s: Pick<ProgressionState, 'snapshot' | 'seenAt'>): boolean {
  return !!s.snapshot?.awards.some(a => a.at > s.seenAt && a.id !== 'unlock:trophy-cabinet')
}

export function isUnlocked(snap: ProgressionSnapshot | null, id: string): boolean {
  return !!snap?.unlocks.find(u => u.id === id)?.unlocked
}

export function isRevealing(s: Pick<ProgressionState, 'reveals'>, id: string, now = Date.now()): boolean {
  return s.reveals.some(r => r.id === id && now - r.at < REVEAL_MS)
}

/** "3 min", "1 h 5 min", "under a minute" */
export function formatDuration(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 1) return 'under a minute'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`
}

const KIND_LABEL: Record<string, string> = {
  turn: 'Turns finished', worker: 'Workers done', test_ok: 'Green test runs', build_ok: 'Clean builds',
  ea_compile: 'EA compiles (0 errors)', commit: 'Commits', push: 'Pushes', pr_merge: 'PRs merged', deploy: 'Deploys',
  mt5_run: 'MT5 tester runs', mt5_report: 'Tester reports filed', walk_forward: 'Walk-forward runs', lesson: 'Lessons learned',
  equity_high: 'Demo equity highs', test_fail: 'Failed test runs', build_fail: 'Failed builds', deploy_fail: 'Failed deploys',
  worker_fail: 'Workers that failed', ea_compile_fail: 'EA compiles with errors', repeat: 'Repeats (no XP)',
}
export function kindLabel(kind: string): string { return KIND_LABEL[kind] ?? kind }

/** Rows of a day or quarter: XP earners first (by XP), then the failures and repeats. */
export function kindRows(kinds: Record<string, { count: number; xp: number }>): { kind: string; label: string; count: number; xp: number; tone: 'good' | 'bad' | 'dim' }[] {
  return Object.entries(kinds)
    .filter(([, v]) => v.count > 0)
    .map(([kind, v]) => ({ kind, label: kindLabel(kind), count: v.count, xp: v.xp, tone: (/_fail$/.test(kind) ? 'bad' : kind === 'repeat' ? 'dim' : 'good') as 'good' | 'bad' | 'dim' }))
    .sort((a, b) => (a.tone === 'good' ? 0 : 1) - (b.tone === 'good' ? 0 : 1) || b.xp - a.xp || b.count - a.count)
}

/** "2026-Q4" for a date */
export function quarterOf(d: Date): string {
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`
}

export function previousQuarter(q: string): string {
  const y = Number(q.slice(0, 4)); const n = Number(q.slice(-1))
  return n === 1 ? `${y - 1}-Q4` : `${y}-Q${n - 1}`
}

/** The three months of the quarter starting `from` (YYYY-MM-DD) as YYYY-MM. */
export function quarterMonths(from: string): string[] {
  const y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7))
  return [0, 1, 2].map(i => `${y}-${String(m + i).padStart(2, '0')}`)
}
