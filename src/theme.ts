/** theme.ts — the Trading Floor theme pack (cast names, props, chatter) */

import { seasonalUrl } from './season'
import { useSyncExternalStore } from 'react'
import { getVariant, pickIncidentLine, type IncidentLineKind } from './incident'

export type ThemeName = 'default' | 'office'

// The Trading Floor skin (EA fork). It replaces the upstream Dunder Mifflin
// fan-art skin, which is excluded from the MIT licence (NOTICE.md), with an
// original, trading-desk themed cast. The theme id stays 'office' so stored
// settings, ?theme=office and the code paths keep working.
//
// The cast are names, not new sprites: every desk keeps the MIT default
// sprite of its role (getCharacterBaseForRole returns the default base), so
// the office looks exactly like upstream's own art. Each persona gets a
// trading prop over its desk (public/sprites/trading/props, original art).
const OFFICE_CHARACTERS = [
  'quinn-quant', 'rory-risk', 'tess-tester', 'max-execution', 'bea-backtests',
  'dex-data', 'ivy-ideas', 'sol-strategy', 'kit-infra', 'lou-logs',
  'remy-research', 'nia-newsdesk', 'otto-optimiser', 'vera-validation',
  'cam-compliance', 'pip-pricing', 'faye-fills', 'gus-gaps', 'hal-hedging',
  'jo-journal', 'lars-latency', 'mo-montecarlo',
] as const

/** Display names: "Quinn (Quant)" */
const OFFICE_NAMES: Record<string, string> = {
  'quinn-quant': 'Quinn (Quant)', 'rory-risk': 'Rory (Risk)', 'tess-tester': 'Tess (Tester)',
  'max-execution': 'Max (Execution)', 'bea-backtests': 'Bea (Backtests)', 'dex-data': 'Dex (Data)',
  'ivy-ideas': 'Ivy (Ideas)', 'sol-strategy': 'Sol (Strategy)', 'kit-infra': 'Kit (Infra)',
  'lou-logs': 'Lou (Logs)', 'remy-research': 'Remy (Research)', 'nia-newsdesk': 'Nia (News desk)',
  'otto-optimiser': 'Otto (Optimiser)', 'vera-validation': 'Vera (Validation)', 'cam-compliance': 'Cam (Compliance)',
  'pip-pricing': 'Pip (Pricing)', 'faye-fills': 'Faye (Fills)', 'gus-gaps': 'Gus (Gaps)',
  'hal-hedging': 'Hal (Hedging)', 'jo-journal': 'Jo (Journal)', 'lars-latency': 'Lars (Latency)',
  'mo-montecarlo': 'Mo (Monte Carlo)',
  'desk-head': 'Desk Head', 'claude-analyst': 'Claude (Analyst)',
}

// Fixed casting by role — same character used for Slack avatar AND room sprite
const FIXED_ROLE_CASTING: Record<string, string> = {
  boss: 'desk-head',
  assistant: 'claude-analyst',
}

interface ThemeState {
  name: ThemeName
  // Role → Office character slug. Keyed by role so SlackChat (role) and
  // Character.tsx (agent.role) resolve to the same cast.
  castByRole: Record<string, string>
}

// Why: declared before `state` — loadInitial() runs at module load and reads them
const THEME_KEY = 'agent-office-theme'
const CAST_KEY = 'agent-office-cast'

let state: ThemeState = loadInitial()
const listeners = new Set<() => void>()

function loadInitial(): ThemeState {
  const base: ThemeState = { name: 'default', castByRole: {} }
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'office') base.name = 'office'
    // Why: the cast is restored with the theme so a reload (or /trading-floor
    // off → on) keeps every role's character instead of re-dealing (C47)
    const cast = JSON.parse(localStorage.getItem(CAST_KEY) ?? 'null')
    if (cast && typeof cast === 'object' && cast.castByRole && typeof cast.castByRole === 'object') {
      const castByRole: Record<string, string> = {}
      for (const [role, slug] of Object.entries(cast.castByRole)) {
        // Why: a cast saved by the old skin (or anything unknown) is dropped and re-dealt
        if (typeof slug === 'string' && slug in OFFICE_NAMES) castByRole[role] = slug
      }
      base.castByRole = castByRole
    }
  } catch {}
  return base
}

function persist() {
  try {
    localStorage.setItem(THEME_KEY, state.name)
    localStorage.setItem(CAST_KEY, JSON.stringify({ castByRole: state.castByRole }))
  } catch {}
}

function emit() { listeners.forEach(l => l()) }

function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a as T[]
}
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

export function getTheme(): ThemeName { return state.name }

export function setTheme(name: ThemeName) {
  if (state.name === name) return
  // Why: the cast survives a toggle, so turning the Office theme off and on
  // again brings the same characters back
  state = { ...state, name }
  persist()
  emit()
}

export function toggleTheme() {
  setTheme(state.name === 'office' ? 'default' : 'office')
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useTheme(): ThemeName {
  return useSyncExternalStore(
    (cb) => subscribeTheme(cb),
    () => state.name,
    () => 'default',
  )
}

function dealt(): Set<string> { return new Set(Object.values(state.castByRole)) }

/**
 * The Trading Floor persona dealt to a role (dealt on first ask, kept after).
 * Same for SlackChat & Character.
 */
export function castForRole(role: string): string {
  if (state.castByRole[role]) return state.castByRole[role]

  // Fixed casting wins
  const fixed = FIXED_ROLE_CASTING[role]
  if (fixed) {
    state.castByRole[role] = fixed
    return fixed
  }

  // Pick from remaining — exclude already-dealt + reserved-fixed-not-yet-used
  const used = dealt()
  const reservedNotYetUsed = new Set(
    Object.values(FIXED_ROLE_CASTING).filter(c => !used.has(c))
  )
  const pool = OFFICE_CHARACTERS.filter(c => !used.has(c) && !reservedNotYetUsed.has(c))
  // Fallback when all 22 are dealt: reuse an existing non-fixed cast slug.
  // Why: prevents duplicating the boss or the assistant on screen when chat roles overflow.
  const fixedSet = new Set(Object.values(FIXED_ROLE_CASTING))
  const nonFixedUsed = [...used].filter(c => !fixedSet.has(c))
  const chosen = pool.length > 0
    ? pick(pool as string[])
    : (nonFixedUsed.length > 0 ? pick(nonFixedUsed) : OFFICE_CHARACTERS[2]) // Why: any non-fixed persona
  state.castByRole[role] = chosen
  persist()
  return chosen
}

/** The sprite base for a role: always the MIT default sprite (the Trading Floor deals names and props, not art). */
export function getCharacterBaseForRole(role: string, defaultBase: string): string {
  if (state.name === 'office') castForRole(role)
  return defaultBase
}

export function getSpriteDir(): string {
  return '/sprites/characters'
}

/** Kept signature-compatible for existing callers — agentId ignored; role is the key. */
export function getSpritePath(_agentId: string, role: string, defaultBase: string, direction: string): string {
  const base = getCharacterBaseForRole(role, defaultBase)
  // Why seasonalUrl: a seasonal copy (…-xmas.webp at Christmas, …-autumn.webp
  // in autumn; src/season.ts) replaces the sprite once that file exists;
  // until then this is the normal sprite
  return seasonalUrl(`${getSpriteDir()}/${base}-${direction}.png`)
}

export function getRoomImage(phase: 'day' | 'night'): string {
  // The Trading Floor uses upstream's own (MIT) rooms
  return seasonalUrl(phase === 'night' ? '/rooms/office-night.png' : '/rooms/office-day.png')
}

/** Human-readable display name for a slug ("quinn-quant" → "Quinn (Quant)") */
function slugToName(slug: string): string {
  return OFFICE_NAMES[slug] ?? slug.split('-').map(p => p[0].toUpperCase() + p.slice(1)).join(' ')
}

/** Swap sender display name to the cast Office character when theme is active. */
export function themedDisplayName(role: string, fallback: string): string {
  if (state.name !== 'office') return fallback
  const cast = state.castByRole[role]
  if (!cast) {
    // Force-assign so the name matches the avatar on first render
    return slugToName(castForRole(role))
  }
  return slugToName(cast)
}

// ===== THEMED CHATTER POOLS =====

const OFFICE_SPAWN = [
  'logged in to the trading floor',
  'tester agents warming up',
  'pulling the latest ticks',
  'checking the economic calendar',
  'coffee, then the DAX open',
  'risk limits loaded',
  'MT5 terminal is up',
]
const OFFICE_WORK = [
  'running the real-ticks backtest',
  'sizing the next trade',
  'checking the drawdown',
  'reconciling fills',
  'reading the tester journal',
  'walking forward',
  'comparing against the baseline',
]
const OFFICE_DONE = [
  'green across the board',
  'baseline reproduced',
  'risk checks pass',
  'logged in the ledger',
  'no look-ahead found',
  'merged after the walk-forward',
]
const OFFICE_COFFEE = [
  'coffee before the open',
  'espresso, the tester is slow',
  'refill while the optimiser runs',
  'brb, break room',
]
const OFFICE_WATER = [
  'water while the ticks load',
  'hydrate, the session is long',
  'quick break before the close',
  'break room run',
]

const DEFAULT_SPAWN = [
  'reporting for duty!', 'clocked in', 'ready to ship',
  'coffee first, then code', "let's do this", 'opening vim...', 'pulling latest main',
]
const DEFAULT_WORK = [
  'on it', 'typing furiously', 'in the zone', 'making progress',
  'checking the docs', 'git blame time', 'stack overflow to the rescue',
]
const DEFAULT_DONE = [
  'task complete!', 'shipped it', 'PR opened', 'done and dusted',
  'LGTM', 'merged to main', 'deployed',
]
const DEFAULT_COFFEE = ['brb, coffee', 'need caffeine', 'grabbing a cup', 'coffee run']
const DEFAULT_WATER = [
  'stay hydrated', 'h2o break', 'water run', 'refilling bottle',
  'hydration check', 'quick water break',
]

// Pool order: incident variant (while active) → theme → default. Under the
// Trading Floor + incident it is 50/50 so the desk keeps its voice.
function variantLine(kind: IncidentLineKind): string | null {
  if (getVariant() !== 'incident') return null
  if (state.name === 'office' && Math.random() < 0.5) return null
  return pickIncidentLine(kind)
}

export function themedSpawn(): string  { return variantLine('spawn')  ?? pick(state.name === 'office' ? OFFICE_SPAWN  : DEFAULT_SPAWN) }
export function themedWork(): string   { return variantLine('work')   ?? pick(state.name === 'office' ? OFFICE_WORK   : DEFAULT_WORK) }
export function themedDone(): string   { return variantLine('done')   ?? pick(state.name === 'office' ? OFFICE_DONE   : DEFAULT_DONE) }
export function themedCoffee(): string { return variantLine('coffee') ?? pick(state.name === 'office' ? OFFICE_COFFEE : DEFAULT_COFFEE) }
export function themedWater(): string  { return variantLine('water')  ?? pick(state.name === 'office' ? OFFICE_WATER  : DEFAULT_WATER) }

// ===== SIM / VIDEO MODE OFFICE SCRIPT =====
// Parallel tool-output messages keyed by role — used when ?sim or ?video loads with Office theme.
export const OFFICE_SIM_TOOL_MESSAGES: Record<string, string[]> = {
  'security-auditor': [
    '⚡ auditing the broker credentials handling',
    '⚠️ an API key sits in a plain-text .set file',
    '🚨 the webhook secret never expires',
    'moving secrets to the OS credential store',
  ],
  'code-reviewer': [
    '⚡ running: grep -r "OrderSend" src/',
    '🔍 reviewing — this lot rounding needs a cap',
    '💡 suggesting one sizing function instead of three',
    'lgtm once the walk-forward is green',
  ],
  'frontend-developer': [
    '⚡ editing dashboard/equity-curve.tsx',
    '🎨 the equity wall reads well at a glance now',
    'I can handle the dashboard migration',
    'responsive on mobile — the drawdown chart too',
  ],
  'assistant': [
    'the tester froze on 2020-03 again. one more run.',
    'someone check the Monday rule, it skipped a day',
    "I'll handle it — logging it in the ledger first",
  ],
  'boss': [
    'pizza in the break room, green month!',
    'anyone want a coffee before the open?',
    'ship it to demo first, never straight to live',
    'how are we looking on the equity curve?',
  ],
}

/** Sim replacement for the typed questions, when theme is the Trading Floor */
export const OFFICE_SIM_BOSS_PROMPTS = [
  '/ultra-think audit our order sizing like a risk desk would',
  'how bad is the one-lot rounding — worse than the 2020 crash day?',
]

// ===== Rotation helpers for the Office ?sim rotation =====

export function getAllOfficeCharacters(): readonly string[] { return OFFICE_CHARACTERS }

/** Force a specific role → character mapping (used by sim rotation). */
export function assignCharacterToRole(role: string, slug: string) {
  state.castByRole[role] = slug
  persist()
  emit()
}

/** Release a role's cast slot so another role can use that character later. */
export function releaseRole(role: string) {
  const slug = state.castByRole[role]
  if (!slug) return
  delete state.castByRole[role]
  persist()
  emit()
}

/** Return the set of character slugs currently on-screen (dealt to some role). */
export function getActiveCastSlugs(): Set<string> {
  return new Set(Object.values(state.castByRole))
}

/**
 * Pick the next unused Office character — cycles fairly through all 22 over time.
 * @param ignoreSet  extra slugs to avoid (e.g. just-used)
 */
export function nextUnusedOfficeCharacter(ignoreSet: Set<string> = new Set()): string {
  const used = getActiveCastSlugs()
  const avail = OFFICE_CHARACTERS.filter(c => !used.has(c) && !ignoreSet.has(c))
  if (avail.length > 0) return pick(avail as string[])
  // All 22 on-screen: pick any not in the ignore set
  const fallback = OFFICE_CHARACTERS.filter(c => !ignoreSet.has(c))
  return fallback.length > 0 ? pick(fallback as string[]) : OFFICE_CHARACTERS[0]
}

/** Display name for a slug — used when renaming sim staff on spawn. */
export function displayNameFromSlug(slug: string): string {
  return slugToName(slug)
}

// Trading props over a persona's desk, in place of the energy-drink bubble.
// Original art (public/sprites/trading/props, MIT like the rest of the fork).
const TRADING_PROPS = [
  '/sprites/trading/props/candle-mug.png',
  '/sprites/trading/props/bull-trophy.png',
  '/sprites/trading/props/equity-curve-frame.png',
  '/sprites/trading/props/ticker-tape.png',
  '/sprites/trading/props/lot-calculator.png',
  '/sprites/trading/props/stop-loss-sign.png',
  '/sprites/trading/props/backtest-clipboard.png',
  '/sprites/trading/props/trader-bear.png',
]

/** Fixed props for the personas whose job says what they hold */
const PROP_BY_SLUG: Record<string, string> = {
  'desk-head': '/sprites/trading/props/bull-trophy.png',
  'rory-risk': '/sprites/trading/props/stop-loss-sign.png',
  'bea-backtests': '/sprites/trading/props/backtest-clipboard.png',
  'pip-pricing': '/sprites/trading/props/lot-calculator.png',
  'nia-newsdesk': '/sprites/trading/props/ticker-tape.png',
  'mo-montecarlo': '/sprites/trading/props/equity-curve-frame.png',
}

/** Every prop the theme can ask for (scripts/check-assets.mjs) */
export const OFFICE_PROP_PATHS: readonly string[] = TRADING_PROPS

// Stable per-role prop assignment — deterministic hash so it doesn't flicker.
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Prop sprite override for a given role's persona, or null to fall back to energy drink. */
export function getOfficePropForRole(role: string): string | null {
  if (state.name !== 'office') return null
  const slug = state.castByRole[role]
  if (!slug) return null
  return PROP_BY_SLUG[slug] ?? TRADING_PROPS[hashString(slug) % TRADING_PROPS.length]
}
