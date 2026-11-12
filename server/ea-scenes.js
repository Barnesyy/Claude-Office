/**
 * ea-scenes.js — the EA-development scenes: what Jake's Claude Code sessions
 * are doing to his MT5 Expert Advisors, read from their tool calls, so the
 * office can show it (src/eaScenes.ts draws it).
 *
 *   backtest station   a Bash / PowerShell call that runs `terminal64.exe
 *                      /config:<ini>` (the strategy tester) or `metaeditor64.exe
 *                      /compile:<file>` lights the station while it runs. When
 *                      it ends, the tester report named by the ini's
 *                      `Report=` (or a path the command printed, or a fresh
 *                      report in the configured reports folder) is read for
 *                      net profit, max drawdown and trades. Nothing is ever
 *                      estimated: no readable report means "report not found".
 *                      A compile reads its log ("Result: N errors, M
 *                      warnings"); errors light it red.
 *   equity wall        the balance after each deal of the newest real tester
 *                      report (that run's, or the newest in `ea.reportsDir`).
 *                      The report's deal table carries balance, not floating
 *                      equity, so the curve is labelled a balance curve.
 *   desk screens       a thread that reads or edits a .mq5 / .mqh / .set file
 *                      gets MetaEditor and a DAX M15 chart on its monitors.
 *   tick archive       a tick-data tool (dukascopy, .bi5, tick downloads ...)
 *                      opens filing cabinets labelled with the years it names.
 *   risk badge         an edit to a .mq5 / .mqh that touches lot sizing, risk
 *                      or stop-loss code (identifier match) raises an info flag.
 *
 * Input: the rebuilt hook payloads of the transcript watcher (POST
 * /ea/payload, slimmed by slimPayload in the watcher). Output: one `ea_state`
 * broadcast with the whole (small) state after each change. Read-only:
 * nothing here writes a file, runs a program or talks to MT5.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { payloadTime } from './transcript-source.js'
import { findWorkbench, readWorkbench as readWorkbenchFiles } from './ea-workbench.js'

// ---------------------------------------------------------------------------
// Configuration (office.config.json "ea" block, env overrides)
// ---------------------------------------------------------------------------

export const EA_DEFAULTS = Object.freeze({
  /** Folder with MT5 tester reports for the equity wall (null: only runs the office saw) */
  reportsDir: null,
  /** Extra folders a relative Report= path is resolved against (MT5 data folders) */
  terminalDataDirs: [],
  /** How long a finished (or background) tester run waits for its report to appear */
  reportWaitMinutes: 20,
  /** How long a .mq5 / .set touch keeps the DAX / MetaEditor screens up */
  screenMinutes: 10,
  /** How long a risk badge stays up */
  riskMinutes: 30,
  /** How long the tick cabinets stay on the floor after the last tick-data call */
  cabinetMinutes: 60,
  /** How often the reports folder is rescanned */
  rescanSeconds: 30,
  /** The equity wall keeps a curve up at least this long before an automatic switch (a pick or a run you started switches at once) */
  equityDwellMinutes: 10,
  /** EA Workbench folder (its runqueue lights the station); null: %LOCALAPPDATA%\\EAWorkbench if it has one; false: off */
  workbench: null,
  /** How long the station shows the Workbench's last finished run once nothing runs */
  workbenchRecentMinutes: 60,
})

/** The EA settings: office.config.json's `ea` block over the defaults; AGENT_OFFICE_EA_REPORTS_DIR wins. */
export function resolveEaConfig(officeConfig = {}, env = process.env) {
  const raw = officeConfig && typeof officeConfig.ea === 'object' && officeConfig.ea ? officeConfig.ea : {}
  const num = (v, d, min = 0) => (Number.isFinite(Number(v)) && Number(v) >= min ? Number(v) : d)
  const dirs = Array.isArray(raw.terminalDataDirs) ? raw.terminalDataDirs.filter(d => typeof d === 'string' && d) : []
  return {
    reportsDir: env.AGENT_OFFICE_EA_REPORTS_DIR || (typeof raw.reportsDir === 'string' && raw.reportsDir ? raw.reportsDir : null),
    terminalDataDirs: dirs,
    reportWaitMinutes: num(raw.reportWaitMinutes, EA_DEFAULTS.reportWaitMinutes),
    screenMinutes: num(raw.screenMinutes, EA_DEFAULTS.screenMinutes),
    riskMinutes: num(raw.riskMinutes, EA_DEFAULTS.riskMinutes),
    cabinetMinutes: num(raw.cabinetMinutes, EA_DEFAULTS.cabinetMinutes),
    rescanSeconds: num(raw.rescanSeconds, EA_DEFAULTS.rescanSeconds, 1),
    equityDwellMinutes: num(raw.equityDwellMinutes, EA_DEFAULTS.equityDwellMinutes),
    workbench: raw.workbench === false ? false : typeof raw.workbench === 'string' && raw.workbench ? raw.workbench : null,
    workbenchRecentMinutes: num(raw.workbenchRecentMinutes, EA_DEFAULTS.workbenchRecentMinutes),
    appData: env.APPDATA || null,
    localAppData: env.LOCALAPPDATA || null,
  }
}

// ---------------------------------------------------------------------------
// Paths (Windows paths on any OS: the tests run on Linux, Jake on Windows)
// ---------------------------------------------------------------------------

const isWinPath = p => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || (p.includes('\\') && !p.includes('/'))
export function isAbsoluteAny(p) { return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/') }
export function joinAny(base, rel) { return isWinPath(base) ? path.win32.join(base, rel) : path.posix.join(base, rel) }
export function dirnameAny(p) { return isWinPath(p) ? path.win32.dirname(p) : path.posix.dirname(p) }
export function basenameAny(p) { return String(p).split(/[\\/]/).pop() || String(p) }
const extOf = p => (/\.([A-Za-z0-9]+)$/.exec(basenameAny(p))?.[1] ?? '').toLowerCase()

/** The argument after `/flag:` or `/flag=` (quoted or bare), or null; `''` when the flag stands alone. */
export function flagValue(command, flag) {
  const re = new RegExp(`(?:^|[\\s"'])[/-]${flag}(?:[:=]\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"']+)))?`, 'i')
  const m = re.exec(command)
  if (!m) return null
  return (m[1] ?? m[2] ?? m[3] ?? '').trim()
}

/** The quoted or bare path of an executable named `exe` in the command, or null. */
function exePath(command, exe) {
  const re = new RegExp(`"([^"]*?${exe}(?:\\.exe)?)"|'([^']*?${exe}(?:\\.exe)?)'|([^\\s"']*${exe}(?:\\.exe)?)`, 'i')
  const m = re.exec(command)
  return m ? (m[1] ?? m[2] ?? m[3]) : null
}

// ---------------------------------------------------------------------------
// What a command is
// ---------------------------------------------------------------------------

const TICK_WORDS = /dukascopy|\.bi5\b|\bticks?(?:[_\-. ]?(?:data|download|dl|fetch|export|import|archive|history|db|store|merge|check|audit))?\b|tick_?data|real[_ -]?ticks|tickstory|\bticks?[_-]\w+\.(?:py|ps1|mjs|js|csv|parquet)/i

/**
 * What a shell command does for the EA: a tester run, a compile, a tick-data tool, or null.
 * @param {string} command the Bash / PowerShell command line
 */
export function classifyCommand(command) {
  const cmd = String(command ?? '')
  if (!cmd.trim()) return null
  if (/terminal64(?:\.exe)?/i.test(cmd) && /[/-]config[:=]/i.test(cmd)) {
    const configPath = flagValue(cmd, 'config') || null
    const terminal = exePath(cmd, 'terminal64')
    return { kind: 'backtest', configPath, terminalDir: terminal && isAbsoluteAny(terminal) ? dirnameAny(terminal) : null }
  }
  if (/metaeditor(?:64)?(?:\.exe)?/i.test(cmd) && /[/-]compile[:=]/i.test(cmd)) {
    const sourcePath = flagValue(cmd, 'compile') || null
    const log = flagValue(cmd, 'log')
    return { kind: 'compile', sourcePath, logPath: log === null ? null : log || (sourcePath ? sourcePath.replace(/\.[^.\\/]+$/, '') + '.log' : null), logFlag: log !== null }
  }
  if (TICK_WORDS.test(cmd)) return { kind: 'tickdata', years: yearsIn(cmd) }
  return null
}

const MIN_YEAR = 1990
const MAX_YEAR = 2039

/** The years a command or path names: 2019, ranges like 2013-2018 / --from 2013 --to 2018 (expanded, at most 40). */
export function yearsIn(text) {
  const s = String(text ?? '')
  const years = new Set()
  const ok = y => y >= MIN_YEAR && y <= MAX_YEAR
  const range = (a, b) => { if (ok(a) && ok(b) && b >= a && b - a <= 40) for (let y = a; y <= b; y++) years.add(y) }
  // 2013-2018, 2013..2018, 2013 to 2018 (not a date: the second number is a year too)
  for (const m of s.matchAll(/(?<![\d.])((?:19|20)\d\d)\s*(?:-|–|\.\.|\bto\b)\s*((?:19|20)\d\d)(?![\d])/g)) range(+m[1], +m[2])
  // --from 2013 ... --to 2018 (dates count by their year)
  const from = /(?:from|start)[\w-]*[\s=:]+["']?((?:19|20)\d\d)/i.exec(s)
  const to = /(?:\bto|end|until)[\w-]*[\s=:]+["']?((?:19|20)\d\d)/i.exec(s)
  if (from && to) range(+from[1], +to[1])
  for (const m of s.matchAll(/(?<![\d])((?:19|20)\d\d)(?![\d])/g)) if (ok(+m[1])) years.add(+m[1])
  return [...years].sort((a, b) => a - b)
}

/** Whether a path names tick data (a ticks folder, a .bi5, a dukascopy cache). */
export function isTickPath(p) {
  return /dukascopy|\.bi5$|[\\/_-]ticks?(?:[_-]?data)?[\\/_.-]|^ticks?[\\/_.-]|tick_?data/i.test(String(p ?? ''))
}

/** .mq5 / .mqh, .set, or null */
export function eaFileKind(p) {
  const e = extOf(String(p ?? ''))
  if (e === 'mq5' || e === 'mqh') return 'mq5'
  if (e === 'set') return 'set'
  return null
}

// ---------------------------------------------------------------------------
// Risk code (an identifier match, an info flag only)
// ---------------------------------------------------------------------------

const RISK_WORDS = {
  'lot sizing': new Set(['lot', 'lots', 'lotsize', 'lotstep', 'volume', 'volumes', 'minlot', 'maxlot']),
  'risk': new Set(['risk', 'riskpct', 'riskpercent', 'maxrisk', 'budget']),
  'stop-loss': new Set(['sl', 'stoploss', 'stops', 'stoplevel', 'stopslevel']),
}

/**
 * The risk categories a piece of MQL5 touches: lot sizing (Lots, CalcLotSize,
 * SYMBOL_VOLUME_STEP), risk (InpRiskPercent, budget) and stop-loss (sl,
 * StopLoss, SYMBOL_TRADE_STOPS_LEVEL), with a few of the identifiers that matched.
 * @returns {{ categories: string[], terms: string[] }}
 */
export function riskTouches(text) {
  const categories = new Set()
  const terms = new Set()
  const src = String(text ?? '').slice(0, 400_000)
  for (const m of src.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const ident = m[0]
    const words = ident.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[\s_]+/).map(w => w.toLowerCase()).filter(Boolean)
    let hit = null
    for (let i = 0; i < words.length && !hit; i++) {
      const w = words[i]
      for (const [cat, set] of Object.entries(RISK_WORDS)) if (set.has(w)) { hit = cat; break }
      if (!hit && w === 'stop' && words[i + 1] === 'loss') hit = 'stop-loss'
    }
    if (hit) { categories.add(hit); if (terms.size < 6) terms.add(ident) }
  }
  const order = ['lot sizing', 'risk', 'stop-loss']
  return { categories: order.filter(c => categories.has(c)), terms: [...terms] }
}

/** The code an edit tool call changes (old and new text), or '' for anything else. */
export function editedText(toolName, input = {}) {
  if (!input || typeof input !== 'object') return ''
  switch (toolName) {
    case 'Edit': return `${input.old_string ?? ''}\n${input.new_string ?? ''}`
    case 'MultiEdit': return (Array.isArray(input.edits) ? input.edits : []).map(e => `${e?.old_string ?? ''}\n${e?.new_string ?? ''}`).join('\n')
    case 'Write': return String(input.content ?? '')
    default: return ''
  }
}

// ---------------------------------------------------------------------------
// Reading MT5 files (UTF-16 reports, ini, logs)
// ---------------------------------------------------------------------------

/** Text of an MT5 file: UTF-16LE (with or without BOM), UTF-16BE or UTF-8. */
export function decodeText(buf) {
  if (typeof buf === 'string') return buf
  if (!buf || !buf.length) return ''
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); b.swap16?.(); return b.toString('utf16le') }
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  // No BOM: many zero bytes in odd places means UTF-16LE
  let zeros = 0
  const n = Math.min(buf.length, 400)
  for (let i = 1; i < n; i += 2) if (buf[i] === 0) zeros++
  return zeros > n / 6 ? buf.toString('utf16le') : buf.toString('utf8')
}

const MAX_REPORT_BYTES = 64 * 1024 * 1024

function readTextFile(p, max = MAX_REPORT_BYTES) {
  try {
    const st = statSync(p)
    if (!st.isFile() || st.size > max) return null
    return { text: decodeText(readFileSync(p)), mtime: st.mtimeMs }
  } catch { return null }
}

/** An ini file as { section: { key: value } } (keys lower-cased). */
export function parseIni(text) {
  const out = {}
  let section = ''
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const sec = /^\[(.+)\]$/.exec(line)
    if (sec) { section = sec[1].trim().toLowerCase(); out[section] ??= {}; continue }
    const i = line.indexOf('=')
    if (i < 0) continue
    ;(out[section] ??= {})[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return out
}

const MODELS = { 0: 'every tick', 1: '1 minute OHLC', 2: 'open prices only', 3: 'math calculations', 4: 'every tick based on real ticks' }

/** What a tester ini sets up: the EA, symbol, period, model, dates and the report path. */
export function testerSetup(text) {
  const t = parseIni(text).tester ?? {}
  const model = t.model !== undefined && /^\d$/.test(t.model) ? Number(t.model) : null
  return {
    expert: t.expert ?? null, symbol: t.symbol ?? null, period: t.period ?? null,
    model, modelName: model === null ? null : MODELS[model] ?? `model ${model}`,
    fromDate: t.fromdate ?? null, toDate: t.todate ?? null, report: t.report ?? null,
  }
}

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function stripTags(html) {
  return html.replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCharCode(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m)
    .replace(/[\s\u00a0]+/g, ' ').trim()
}

/** The rows of an HTML report (cells as text; a missing </td> is tolerated). */
function htmlRows(html) {
  const rows = []
  for (const tr of html.split(/<tr[\s>]/i).slice(1)) {
    const body = tr.split(/<\/tr>/i)[0]
    const cells = []
    for (const td of body.split(/<t[dh](?=[\s>])/i).slice(1)) {
      const open = /^[^>]*>/.exec(td)
      const colspan = open ? Number(/colspan\s*=\s*["']?(\d+)/i.exec(open[0])?.[1] ?? 1) : 1
      cells.push(stripTags(td.slice(open ? open[0].length : 0).split(/<\/t[dh]>/i)[0]))
      for (let k = 1; k < Math.min(colspan, 20); k++) cells.push('')
    }
    rows.push(cells)
  }
  return rows
}

/** The rows of an Excel 2003 XML (SpreadsheetML) report, ss:Index honoured. */
function xmlRows(xml) {
  const rows = []
  for (const m of xml.matchAll(/<Row\b[^>]*?(?:\/>|>([\s\S]*?)<\/Row>)/g)) {
    const cells = []
    for (const c of (m[1] ?? '').matchAll(/<Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Cell>)/g)) {
      const idx = /ss:Index\s*=\s*"(\d+)"/.exec(c[1])
      if (idx) while (cells.length < Number(idx[1]) - 1) cells.push('')
      cells.push(stripTags(c[2] ?? ''))
      const across = /ss:MergeAcross\s*=\s*"(\d+)"/.exec(c[1])
      if (across) for (let k = 0; k < Math.min(Number(across[1]), 20); k++) cells.push('')
    }
    rows.push(cells)
  }
  return rows
}

/** "1 234.56", "-1 234.56", "12.34%" -> number; null when it is not one. */
export function parseNum(s) {
  if (s === null || s === undefined) return null
  const m = /^[-+−]?\s*\d[\d\s\u00a0'’,.]*/.exec(String(s).trim())
  if (!m) return null
  let t = m[0].replace(/[\s\u00a0'’]/g, '').replace('−', '-').replace(/[.,]+$/, '')
  const comma = t.lastIndexOf(',')
  const dot = t.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) {
    // "1,234.56" or "1.234,56": the later one is the decimal point
    t = comma > dot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  } else if (comma >= 0) {
    // "1,234" / "1,234,567" are thousands; "1234,56" is a decimal comma
    t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.')
  } else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** "1 234.56 (12.34%)" -> { value, pct }; "12.34% (1 234.56)" -> the same. */
function amountAndPct(s) {
  if (!s) return { value: null, pct: null }
  const str = String(s)
  const pctFirst = /^\s*([-\d\s.,]+)%\s*\(([^)]*)\)/.exec(str)
  if (pctFirst) return { value: parseNum(pctFirst[2]), pct: parseNum(pctFirst[1]) }
  const inner = /\(([-\d\s.,]+)%\)/.exec(str)
  return { value: parseNum(str), pct: inner ? parseNum(inner[1]) : null }
}

const SUMMARY_LABELS = {
  'total net profit': 'netProfit', 'gross profit': 'grossProfit', 'gross loss': 'grossLoss',
  'profit factor': 'profitFactor', 'expected payoff': 'expectedPayoff', 'total trades': 'trades',
  'total deals': 'deals', 'initial deposit': 'initialDeposit', 'equity drawdown maximal': 'eqDdMax',
  'balance drawdown maximal': 'balDdMax', 'equity drawdown relative': 'eqDdRel', 'balance drawdown relative': 'balDdRel',
  'expert': 'expert', 'symbol': 'symbol', 'period': 'period', 'currency': 'currency', 'company': 'company',
  'history quality': 'historyQuality', 'bars': 'bars', 'ticks': 'ticks',
}

/** "2024.01.02 09:15:00" -> ms (UTC, as the tester's server time reads), or null */
function reportTime(s) {
  const m = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s ?? '').trim())
  if (!m) return null
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
}

/** At most `max` points, first and last kept, evenly spaced between. */
export function thin(points, max = 400) {
  if (points.length <= max) return points
  const out = []
  const step = (points.length - 1) / (max - 1)
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)])
  return out
}

/**
 * An MT5 strategy tester report (HTML or Excel XML) read for what the office
 * shows. Every number is the report's own; a field the report does not have is null.
 * @returns {null | { netProfit, maxDrawdown, maxDrawdownPct, drawdownKind, trades, initialDeposit, profitFactor, currency, expert, symbol, period, points: [number, number][], dealCount }}
 */
export function parseTesterReport(input) {
  const text = decodeText(input)
  if (!text) return null
  const rows = /<Workbook\b|<ss:Workbook\b|urn:schemas-microsoft-com:office:spreadsheet/i.test(text.slice(0, 4000)) ? xmlRows(text) : htmlRows(text)
  const raw = {}
  let header = null
  const points = []
  for (const cells of rows) {
    if (!header) {
      const lower = cells.map(c => c.toLowerCase())
      if (lower.includes('deal') && lower.includes('balance') && lower.includes('time')) {
        header = { time: lower.indexOf('time'), balance: lower.indexOf('balance'), width: cells.length }
        continue
      }
    } else {
      const t = reportTime(cells[header.time])
      const b = parseNum(cells[header.balance])
      if (t !== null && b !== null && cells.length >= header.balance + 1) { points.push([t, b]); continue }
      if (cells.filter(Boolean).length > 0 && t === null && points.length) header = { ...header, done: true }
    }
    for (let i = 0; i < cells.length; i++) {
      const label = cells[i].replace(/:\s*$/, '').trim().toLowerCase()
      const key = SUMMARY_LABELS[label]
      if (!key || raw[key] !== undefined || !cells[i].trim().endsWith(':')) continue
      const value = cells.slice(i + 1).find(c => c.trim() !== '')
      if (value !== undefined) raw[key] = value
    }
  }
  const eq = amountAndPct(raw.eqDdMax)
  const bal = amountAndPct(raw.balDdMax)
  const eqRel = amountAndPct(raw.eqDdRel)
  const useEq = eq.value !== null
  const out = {
    netProfit: parseNum(raw.netProfit),
    maxDrawdown: useEq ? eq.value : bal.value,
    maxDrawdownPct: useEq ? eq.pct : bal.pct,
    drawdownKind: useEq ? 'equity' : bal.value !== null ? 'balance' : null,
    relativeDrawdownPct: eqRel.pct,
    trades: raw.trades !== undefined ? parseNum(raw.trades) : null,
    initialDeposit: parseNum(raw.initialDeposit),
    profitFactor: parseNum(raw.profitFactor),
    currency: raw.currency ?? null,
    expert: raw.expert ?? null,
    symbol: raw.symbol ?? null,
    period: raw.period ?? null,
    historyQuality: raw.historyQuality ?? null,
    points: thin(points),
    dealCount: points.length,
  }
  if (out.netProfit === null && out.trades === null && points.length === 0) return null
  return out
}

/** "Result: 2 errors, 1 warnings" in a MetaEditor log or the command's output, or null. */
export function parseCompileResult(text) {
  const s = String(text ?? '')
  const all = [...s.matchAll(/(\d+)\s+errors?\s*,\s*(\d+)\s+warnings?/gi)]
  if (!all.length) return null
  const m = all[all.length - 1]
  return { errors: Number(m[1]), warnings: Number(m[2]) }
}

/** Absolute report paths a command printed (C:\...\x.htm, /x/y.xml). */
export function reportPathsIn(text) {
  const out = []
  for (const m of String(text ?? '').matchAll(/(?:[A-Za-z]:[\\/]|\\\\|\/)[^"'<>|\r\n*?]*?\.(?:html?|xml)\b/g)) out.push(m[0].trim())
  return [...new Set(out)]
}

/** The MT5 data folders under %APPDATA%\MetaQuotes\Terminal (each hashed install). */
function appDataTerminals(appData) {
  if (!appData) return []
  const root = joinAny(appData, 'MetaQuotes\\Terminal'.replace(/\\/g, isWinPath(appData) ? '\\' : '/'))
  try { return readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && /^[0-9A-F]{32}$/i.test(d.name)).map(d => joinAny(root, d.name)) } catch { return [] }
}

/** Where a Report= value may be on disk, most likely first. */
export function reportCandidates(report, { iniDir = null, terminalDir = null, dataDirs = [], reportsDir = null } = {}) {
  if (!report) return []
  const bases = isAbsoluteAny(report) ? [''] : [...dataDirs, terminalDir, iniDir, reportsDir].filter(Boolean)
  const names = /\.(html?|xml)$/i.test(report) ? [report] : [`${report}.htm`, `${report}.html`, `${report}.xml`, report]
  const out = []
  for (const b of bases) for (const n of names) out.push(b ? joinAny(b, n) : n)
  return [...new Set(out)]
}

/** The newest tester report in a folder (and its subfolders, one level), or null. */
export function newestReport(dir, { since = 0 } = {}) {
  if (!dir) return null
  const files = []
  const look = (d, depth) => {
    let entries = []
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = joinAny(d, e.name)
      if (e.isDirectory() && depth < 1) look(p, depth + 1)
      else if (e.isFile() && /\.(html?|xml)$/i.test(e.name)) { try { files.push({ p, mtime: statSync(p).mtimeMs }) } catch {} }
    }
  }
  look(dir, 0)
  files.sort((a, b) => b.mtime - a.mtime)
  for (const f of files.slice(0, 12)) {
    if (f.mtime < since) break
    const r = readReport(f.p)
    if (r) return r
  }
  return null
}

/** A report file read and parsed, with where it is and when it was written; null if unreadable or not a report. */
export function readReport(p) {
  const file = readTextFile(p)
  if (!file) return null
  const parsed = parseTesterReport(file.text)
  return parsed ? { ...parsed, path: p, name: basenameAny(p), mtime: file.mtime } : null
}

/** path -> { mtime, report }: a 1.7 MB report is parsed once per write, not on every rescan */
const reportCache = new Map()
export function readReportCached(p) {
  let mtime
  try { mtime = statSync(p).mtimeMs } catch { return null }
  const hit = reportCache.get(p)
  if (hit && hit.mtime === mtime) return hit.report
  const report = readReport(p)
  reportCache.set(p, { mtime, report })
  if (reportCache.size > 200) reportCache.delete(reportCache.keys().next().value)
  return report
}

/** The newest tester reports in a folder (and one level of subfolders), newest first, up to `limit` readable ones. */
export function recentReports(dir, { limit = 12, look = 40 } = {}) {
  if (!dir) return []
  const files = []
  const walk = (d, depth) => {
    let entries = []
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = joinAny(d, e.name)
      if (e.isDirectory() && depth < 1) walk(p, depth + 1)
      else if (e.isFile() && /\.(html?|xml)$/i.test(e.name)) { try { files.push({ p, mtime: statSync(p).mtimeMs }) } catch {} }
    }
  }
  walk(dir, 0)
  files.sort((a, b) => b.mtime - a.mtime)
  const out = []
  for (const f of files.slice(0, look)) {
    const r = readReportCached(f.p)
    if (r) out.push(r)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Which EA a report or build is, loosely: "BrooksSetupTesterDAX_v024_bad76042" and
 * "BrooksSetupTesterDAX_parity_61907080" are both "brookssetuptesterdax"; "SRS_DAX_Corrected_BlackBull"
 * and "SRSLiveR24A15" both start "srs". Versions, hashes and build words fall away.
 */
export function strategyKey(name) {
  if (!name) return null
  const stem = basenameAny(String(name)).replace(/\.(ex5|mq5|htm|html|xml)$/i, '').toLowerCase()
  const segs = stem.split(/[_\s.-]+/).filter(Boolean)
  if (!segs.length) return null
  let key = segs[0].replace(/v?\d.*$/, '')
  if (key.length < 3 && segs[1]) key = `${segs[0]}_${segs[1].replace(/v?\d.*$/, '')}`
  return key.length >= 2 ? key : null
}
export function sameStrategy(a, b) {
  const x = strategyKey(a), y = strategyKey(b)
  return !!x && !!y && (x.startsWith(y) || y.startsWith(x))
}

/** "M5 (2013.01.01 - 2013.12.31)" -> { timeframe: 'M5', from: '2013.01.01', to: '2013.12.31' } */
export function periodParts(period) {
  const m = /^\s*([A-Za-z]+\d*)?\s*(?:\((\d{4}[.\-/]\d{2}[.\-/]\d{2})\s*[-–]\s*(\d{4}[.\-/]\d{2}[.\-/]\d{2})\))?/.exec(String(period ?? ''))
  return { timeframe: m?.[1] ?? null, from: m?.[2] ?? null, to: m?.[3] ?? null }
}

/**
 * One tester result, whatever form or folder it was saved in: MT5 writes the same run as .htm and .xml,
 * and a copied report sits in two terminal folders. Same EA build, symbol, period, deals and result.
 */
export function reportIdentity(r) {
  const last = r.points?.length ? r.points[r.points.length - 1] : null
  // No period: an .xml export leaves it out, and the deals already pin the date range
  return [String(r.expert ?? r.name ?? '').toLowerCase(), r.symbol ?? '', r.netProfit ?? '', r.trades ?? '', r.dealCount ?? 0, last ? last.join(':') : ''].join('|')
}

/** The report's tester folder (the MT5 data folder id it sits in), and that folder's name when known. */
export function reportFolder(p, names = {}) {
  const id = basenameAny(dirnameAny(String(p)))
  const named = Object.entries(names).find(([k]) => k.toUpperCase() === id.toUpperCase())?.[1]
  return { id, name: named || (/^[0-9A-F]{16,}$/i.test(id) ? id.slice(0, 6) : id) }
}

/**
 * The wall's reports, newest first, one entry per result (dedupe by reportIdentity; .htm beats .xml,
 * then the newest file). Each keeps where else it was seen.
 * @returns {Array<{ path: string, report: object, file: string, folder: string, also: number }>}
 */
export function dedupeReports(reports, names = {}) {
  const byId = new Map()
  const rank = r => (/\.html?$/i.test(r.path) ? 1 : 0)
  for (const r of [...reports].filter(Boolean).sort((a, b) => b.mtime - a.mtime)) {
    const k = reportIdentity(r)
    const had = byId.get(k)
    if (!had) { byId.set(k, { r, also: 0 }); continue }
    if (had.r.path === r.path) continue
    had.also++
    if (rank(r) > rank(had.r)) had.r = r
  }
  return [...byId.values()].sort((a, b) => b.r.mtime - a.r.mtime).map(({ r, also }) => ({ path: r.path, report: r, file: basenameAny(r.path), folder: reportFolder(r.path, names).name, also }))
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

const STATION_IDLE = Object.freeze({ status: 'idle', kind: null })
const POOL_MAX = 60
const CHOICES_MAX = 14
const TICKER_MAX = 24
const RUNS_MAX = 8
const RISK_MAX = 8
/** Slack for clocks: a report written this long before the run started still counts as its own */
const CLOCK_SLACK_MS = 5000

function textOfResponse(r) {
  if (r === null || r === undefined) return ''
  if (typeof r === 'string') return r
  if (typeof r === 'object') {
    const parts = [r.stdout, r.stderr, r.output, r.content, r.text].filter(x => typeof x === 'string')
    if (parts.length) return parts.join('\n')
    try { return JSON.stringify(r) } catch { return '' }
  }
  return String(r)
}

const fmt = n => (n === null || n === undefined ? '?' : Math.abs(n) >= 1000 ? n.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : String(Math.round(n * 100) / 100))

/**
 * The EA scenes of the office.
 * @param {object} opts
 * @param {ReturnType<typeof resolveEaConfig>} [opts.config]
 * @param {() => number} [opts.now]
 * @param {(state: object) => void} [opts.onChange] called with snapshot() after each change
 */
export class EaScenes {
  constructor({ config = resolveEaConfig({}, {}), now = () => Date.now(), onChange = () => {}, readWorkbench, pin = null, onPin = () => {} } = {}) {
    this.config = config
    this.now = now
    this.onChange = onChange
    /** The equity wall: a picked report path (null: automatic), when the shown curve went up, what is being worked on */
    this.pin = typeof pin === 'string' && pin ? pin : null
    this.onPin = onPin
    this.shownAt = 0
    this.focus = null
    this.held = null
    this.choices = []
    /** Every recent result (deduped), newest first: what the automatic choice looks through */
    this.pool = []
    /** The EA Workbench run queue (server/ea-workbench.js), read on the rescan */
    this.wbDir = findWorkbench(config.workbench, config.localAppData)
    this.readWorkbench = readWorkbench ?? (dir => readWorkbenchFiles(dir, { appData: config.appData, readReport: readReportCached, now: this.now() }))
    this.wb = null
    this.wbRunning = null
    this.station = { ...STATION_IDLE }
    /** tool_use_id -> the running call */
    this.calls = new Map()
    this.runs = []
    this.ticker = []
    this.equity = null
    /** year -> { lastAt, running: Set<tool_use_id> } */
    this.years = new Map()
    this.cabinetsAt = 0
    /** thread key -> { sessionId, agentId, kind, file, at } */
    this.screens = new Map()
    this.risk = []
    this.riskSeq = 0
    this.lastScan = 0
  }

  changed() { try { this.onChange(this.snapshot()) } catch {} }

  say(text, tone = 'info') {
    this.ticker.push({ at: this.now(), text: String(text).slice(0, 140), tone })
    if (this.ticker.length > TICKER_MAX) this.ticker.splice(0, this.ticker.length - TICKER_MAX)
  }

  /**
   * One rebuilt hook payload (the watcher's slimPayload).
   * @returns {boolean} whether anything the office shows changed
   */
  note(p) {
    if (!p || typeof p !== 'object') return false
    const event = p.hook_event_name
    const tool = String(p.tool_name ?? '')
    const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {}
    const id = String(p.tool_use_id ?? '')
    const thread = { sessionId: p.session_id ? String(p.session_id) : undefined, agentId: p.agent_id ? String(p.agent_id) : undefined }
    let changed = false
    // When the call really happened (the transcript's own time; a catch-up read arrives late)
    const nowMs = this.now()
    const now = Number.isFinite(p.at) && p.at > 0 && p.at <= nowMs + 60_000 ? p.at : nowMs

    if (event === 'PreToolUse') {
      // Which files the call is about
      const file = input.file_path ?? input.path ?? input.notebook_path
      const command = typeof input.command === 'string' ? input.command : ''
      const kind = eaFileKind(file) ?? (/\.mq[5h]\b/i.test(command) ? 'mq5' : /\.set\b/i.test(command) ? 'set' : null)
      if (kind) {
        this.touchScreen(thread, kind, file ? basenameAny(file) : (/[^\s"'\\/]+\.(?:mq[5h]|set)\b/i.exec(command)?.[0] ?? ''), now)
        changed = true
      }
      // A risk-code edit (the watcher sends the match, never the code)
      const risk = p.risk && Array.isArray(p.risk.categories) ? p.risk : null
      if (risk && risk.categories.length && eaFileKind(file) === 'mq5') {
        this.risk.push({ id: `r${++this.riskSeq}`, ...thread, file: basenameAny(file), categories: risk.categories.slice(0, 3), terms: (risk.terms ?? []).slice(0, 6).map(String), at: now })
        if (this.risk.length > RISK_MAX) this.risk.splice(0, this.risk.length - RISK_MAX)
        this.say(`risk code edited in ${basenameAny(file)}: ${risk.categories.join(', ')}`, 'warn')
        changed = true
      }
      // Tick data read or written by path
      if (file && isTickPath(file)) {
        const ys = yearsIn(file)
        if (ys.length) { this.touchYears(ys, null, now); changed = true }
      }
      // Shell commands
      if (command && (tool === 'Bash' || tool === 'PowerShell' || tool === 'BashOutput' || /shell|powershell|bash/i.test(tool))) {
        const what = classifyCommand(command)
        if (what?.kind === 'backtest' || what?.kind === 'compile') {
          this.startStation(id, what, thread, input, now)
          if (what.kind === 'backtest') this.touchScreen(thread, 'tester', this.station.config?.expert ? basenameAny(this.station.config.expert) : '', now)
          changed = true
        } else if (what?.kind === 'tickdata') {
          const ys = what.years
          this.touchYears(ys, id, now)
          this.calls.set(id, { kind: 'tickdata', years: ys, at: now })
          this.say(ys.length ? `tick data: ${ys.length > 3 ? `${ys[0]}–${ys[ys.length - 1]}` : ys.join(', ')}` : 'tick data tool running', 'info')
          changed = true
        }
      }
    } else if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
      const call = this.calls.get(id)
      if (call) {
        this.calls.delete(id)
        const failed = event === 'PostToolUseFailure'
        const output = failed ? String(p.error ?? '') : textOfResponse(p.tool_response)
        if (call.kind === 'tickdata') {
          for (const y of call.years) this.years.get(y)?.running.delete(id)
          this.cabinetsAt = now
        } else this.finishStation(call, { failed, output, background: !failed && (input.run_in_background === true || /running in background|background with id/i.test(output)) }, now)
        changed = true
      }
    } else if (event === 'SessionEnd') {
      // A session that ended leaves no tool call of its own running
      for (const [cid, call] of this.calls) {
        if (call.kind !== 'report-wait' && call.sessionId && call.sessionId === thread.sessionId) {
          this.calls.delete(cid)
          if (call.kind !== 'tickdata') this.finishStation(call, { failed: true, output: 'session ended', interrupted: true }, now)
          changed = true
        }
      }
    }
    if (changed) this.changed()
    return changed
  }

  touchScreen(thread, kind, file, now) {
    const key = `${thread.sessionId ?? ''}|${thread.agentId ?? ''}`
    this.screens.set(key, { ...thread, kind, file: String(file ?? '').slice(0, 80), at: now })
  }

  touchYears(years, callId, now) {
    for (const y of years) {
      const e = this.years.get(y) ?? { lastAt: now, running: new Set() }
      e.lastAt = now
      if (callId) e.running.add(callId)
      this.years.set(y, e)
    }
    this.cabinetsAt = now
  }

  startStation(id, what, thread, input, now) {
    const call = { ...what, id, ...thread, at: now }
    if (what.kind === 'backtest' && what.configPath) {
      const ini = readTextFile(what.configPath, 1024 * 1024)
      if (ini) call.config = testerSetup(ini.text)
      call.iniDir = dirnameAny(what.configPath)
    }
    const label = what.kind === 'compile'
      ? `compiling ${what.sourcePath ? basenameAny(what.sourcePath) : 'the EA'}`
      : `testing ${call.config?.expert ? basenameAny(call.config.expert) : 'the EA'}${call.config?.symbol ? ` on ${call.config.symbol}` : ''}${call.config?.period ? ` ${call.config.period}` : ''}`
    call.label = label
    this.calls.set(id, call)
    this.station = {
      status: what.kind === 'compile' ? 'compiling' : 'running', kind: what.kind, label, startedAt: now,
      sessionId: thread.sessionId, agentId: thread.agentId,
      ...(call.config ? { config: pickConfig(call.config) } : {}),
    }
    this.say(`${label}${call.config?.modelName ? ` (${call.config.modelName})` : ''}`, 'info')
  }

  /** Where this run's report should be, most likely first. */
  candidatesFor(call) {
    const dataDirs = [...this.config.terminalDataDirs, ...appDataTerminals(this.config.appData)]
    return reportCandidates(call.config?.report, { iniDir: call.iniDir, terminalDir: call.terminalDir, dataDirs, reportsDir: this.config.reportsDir })
  }

  /** This run's report, if it is on disk and was written for this run; else null (with why, in `.why`). */
  findReport(call, output = '') {
    const since = call.at - CLOCK_SLACK_MS
    const tried = [...reportPathsIn(output), ...this.candidatesFor(call)]
    let stale = null
    for (const p of tried) {
      let st
      try { st = statSync(p) } catch { continue }
      if (!st.isFile()) continue
      if (st.mtimeMs < since) { stale ??= p; continue }
      const r = readReport(p)
      if (r) return { report: r }
    }
    // The configured reports folder: a report written since the run started
    const fresh = this.config.reportsDir ? newestReport(this.config.reportsDir, { since }) : null
    if (fresh) return { report: fresh }
    const why = stale ? `only an older report (${basenameAny(stale)})`
      : call.config?.report ? `no report at ${basenameAny(call.config.report)}`
      : call.configPath && !call.config ? `could not read ${basenameAny(call.configPath)}`
      : 'the ini names no Report= and none was printed'
    return { report: null, why }
  }

  /**
   * Whether a call that ended may change what the station shows: not while a
   * run or compile started after it is still going (that one is on screen).
   */
  ownsStation(call) {
    for (const other of this.calls.values()) {
      if (other.id === call.id || !['backtest', 'compile', 'report-wait'].includes(other.kind)) continue
      if (other.at > call.at) return false
    }
    return true
  }

  /** Sets the station unless a newer call holds it. */
  showStation(call, station) {
    if (this.ownsStation(call)) this.station = station
  }

  finishStation(call, { failed, output, background = false, interrupted = false }, now) {
    if (call.kind === 'compile') {
      let result = null
      let source = null
      if (call.logPath) {
        const log = readTextFile(call.logPath, 8 * 1024 * 1024)
        if (log && log.mtime >= call.at - CLOCK_SLACK_MS) { result = parseCompileResult(log.text); if (result) source = 'log' }
      }
      if (!result) { result = parseCompileResult(output); if (result) source = 'output' }
      if (!result && call.sourcePath) {
        // An .ex5 is only written by a compile with no errors
        const ex5 = call.sourcePath.replace(/\.mq5$/i, '.ex5')
        try { if (ex5 !== call.sourcePath && statSync(ex5).mtimeMs >= call.at - CLOCK_SLACK_MS) { result = { errors: 0, warnings: null }; source = 'ex5' } } catch {}
      }
      const file = call.sourcePath ? basenameAny(call.sourcePath) : 'the EA'
      const status = result ? (result.errors > 0 ? 'compile-error' : 'compile-ok') : 'compile-unknown'
      this.showStation(call, {
        status, kind: 'compile', label: file, startedAt: call.at, finishedAt: now, sessionId: call.sessionId, agentId: call.agentId,
        compile: { errors: result?.errors ?? null, warnings: result?.warnings ?? null, file, source },
        ...(status === 'compile-unknown' ? { note: call.logFlag ? 'compile log not found' : 'no compile log (/log not given) and no .ex5 written' } : {}),
      })
      this.pushRun({ kind: 'compile', status, at: now, label: file, errors: result?.errors ?? null, warnings: result?.warnings ?? null })
      this.say(status === 'compile-error' ? `compile: ${result.errors} error${result.errors === 1 ? '' : 's'} in ${file}` : status === 'compile-ok' ? `compiled ${file}: 0 errors${result.warnings ? `, ${result.warnings} warnings` : ''}` : `compiled ${file}: result unknown`, status === 'compile-error' ? 'bad' : status === 'compile-ok' ? 'good' : 'info')
      return
    }
    // A tester run
    const found = this.findReport(call, output)
    const base = { kind: 'backtest', label: call.label, startedAt: call.at, sessionId: call.sessionId, agentId: call.agentId, ...(call.config ? { config: pickConfig(call.config) } : {}) }
    if (found.report) return this.reportReady(call, found.report, now, base)
    const waitMs = this.config.reportWaitMinutes * 60_000
    if (!interrupted && waitMs > 0 && (background || !failed) && (call.config?.report || this.config.reportsDir)) {
      // The terminal may still be running (started detached, or writing the report): wait for it
      this.showStation(call, { ...base, status: 'awaiting-report', finishedAt: now, waitUntil: now + waitMs, note: 'waiting for the tester report' })
      this.calls.set(`${call.id}#report`, { ...call, kind: 'report-wait', until: now + waitMs })
      return
    }
    this.reportMissing(call, base, found.why, failed ? firstLine(output) : null, now)
  }

  reportReady(call, report, now, base) {
    const summary = reportSummary(report)
    this.showStation(call, { ...base, status: 'done', finishedAt: now, report: summary })
    // A run started from a Claude session is what is being worked on: its curve goes up at once (unless one is picked)
    this.setFocus(report.expert ?? call.config?.expert, 'run', now)
    if (!this.pin) { this.setEquity(report, 'run'); this.shownAt = now; this.held = null }
    this.pushRun({ kind: 'backtest', status: 'done', at: now, label: base.label, netProfit: summary.netProfit, maxDrawdown: summary.maxDrawdown, maxDrawdownPct: summary.maxDrawdownPct, trades: summary.trades })
    this.say(`tester report ${summary.name}: net ${fmt(summary.netProfit)}, max DD ${fmt(summary.maxDrawdown)}${summary.maxDrawdownPct !== null ? ` (${summary.maxDrawdownPct}%)` : ''}, ${summary.trades ?? '?'} trades`, summary.netProfit !== null && summary.netProfit < 0 ? 'bad' : 'good')
  }

  reportMissing(call, base, why, error, now) {
    const status = error ? 'failed' : 'report-missing'
    this.showStation(call, { ...base, status, finishedAt: now, note: `report not found${why ? `: ${why}` : ''}`, ...(error ? { error } : {}) })
    this.pushRun({ kind: 'backtest', status, at: now, label: base.label })
    this.say(`${base.label}: report not found`, error ? 'bad' : 'warn')
  }

  pushRun(run) {
    this.runs.push(run)
    if (this.runs.length > RUNS_MAX) this.runs.splice(0, this.runs.length - RUNS_MAX)
  }

  setEquity(report, source, { force = false } = {}) {
    if (!force && this.equity && this.equity.mtime > report.mtime) return false
    if (this.equity && this.equity.path === report.path && this.equity.mtime === report.mtime && this.equity.source === source) return false
    this.equity = { ...reportSummary(report), ...periodParts(report.period), source, points: report.points, dealCount: report.dealCount }
    return true
  }

  /** What is being worked on (an EA name), from the newest of: a tester run a session started, the Workbench's newest run. */
  setFocus(expert, source, at) {
    const key = strategyKey(expert)
    if (!key) return
    if (this.focus && this.focus.at > at) return
    this.focus = { key, expert: basenameAny(String(expert)).replace(/\.ex5$/i, ''), source, at }
  }

  /**
   * Pick the wall's report: a path from the choices (or the one shown), or null for automatic.
   * @returns {boolean} whether it was accepted
   */
  setPin(p) {
    if (p === null || p === undefined || p === '') {
      this.pin = null
      this.shownAt = 0
      try { this.onPin(null) } catch {}
      this.selectEquity(this.now(), { force: true })
      this.changed()
      return true
    }
    if (typeof p !== 'string') return false
    // Only a report the office listed: the page cannot make the server read an arbitrary file
    const known = this.choices.find(c => c.path === p) ?? this.pool.find(c => c.path === p) ?? (this.equity?.path === p ? this.equity : null)
    if (!known) return false
    const r = readReportCached(p)
    if (!r) return false
    this.pin = p
    try { this.onPin(p) } catch {}
    this.setEquity(r, 'pinned', { force: true })
    this.shownAt = this.now()
    this.held = null
    this.changed()
    return true
  }

  /**
   * The automatic choice: the newest report of the EA being worked on (else the newest of all), switched to
   * only once the shown one has been up equityDwellMinutes, so a queue writing a report a minute does not flicker.
   * @returns {boolean} whether the shown curve changed
   */
  selectEquity(now, { force = false } = {}) {
    if (this.pin) {
      const r = readReportCached(this.pin)
      if (r && (!this.equity || this.equity.path !== r.path || this.equity.mtime !== r.mtime)) return this.setEquity(r, 'pinned', { force: true })
      return false
    }
    const pool = (this.pool.length ? this.pool : this.choices).map(c => c.report)
    if (!pool.length) return false
    const mine = this.focus ? pool.filter(r => sameStrategy(r.expert ?? r.name, this.focus.key)) : []
    const best = (mine.length ? mine : pool)[0]
    if (!best) return false
    if (this.equity && this.equity.path === best.path && this.equity.mtime === best.mtime) { this.held = null; return false }
    const dwellMs = this.config.equityDwellMinutes * 60_000
    const shownFor = now - this.shownAt
    if (!force && this.equity && this.shownAt && shownFor < dwellMs) {
      this.held = { name: best.name, expert: best.expert ?? null, at: this.shownAt + dwellMs }
      return false
    }
    this.held = null
    this.setEquity(best, mine.length ? 'focus' : 'folder', { force: true })
    this.shownAt = now
    return true
  }

  /** The Workbench read again: the station's queue card, the ticker on starts and ends, the focus. */
  noteWorkbench(wb, now) {
    if (!wb?.ok) { const had = !!this.wb?.ok; this.wb = wb ?? null; return had }
    const before = this.wbRunning
    const ids = new Set(wb.running.map(r => r.id))
    let changed = JSON.stringify(this.wbView(this.wb)) !== JSON.stringify(this.wbView(wb))
    if (before) {
      for (const r of wb.running) if (!before.has(r.id)) { this.say(`Workbench: ${r.test} started on ${r.installName}${r.what ? ` — ${r.what.slice(0, 60)}` : ''}`, 'info'); changed = true }
      for (const id of before) if (!ids.has(id) && wb.latest?.id === id) {
        const l = wb.latest
        this.say(l.report ? `Workbench: ${l.test} finished: net ${fmt(l.report.netProfit)}, max DD ${fmt(l.report.maxDrawdown)}${l.report.maxDrawdownPct !== null && l.report.maxDrawdownPct !== undefined ? ` (${l.report.maxDrawdownPct}%)` : ''}, ${l.report.trades ?? '?'} trades` : `Workbench: ${l.test} finished (${l.why ?? 'no report'})`, l.report ? (l.report.netProfit !== null && l.report.netProfit < 0 ? 'bad' : 'good') : 'info')
        changed = true
      }
    }
    this.wbRunning = ids
    this.wb = wb
    if (wb.newest?.expert && wb.newest.startedAt) this.setFocus(wb.newest.expert, 'workbench', wb.newest.startedAt)
    return changed
  }

  /** The Workbench as the page sees it (no paths; numbers only from reports). */
  wbView(wb = this.wb) {
    if (!wb?.ok) return null
    const run = r => ({ id: r.id, test: r.test, install: r.installName, what: r.what, expert: r.expert, symbol: r.symbol, completed: r.completed, planned: r.planned, run: r.run, startedAt: r.startedAt, status: r.status })
    return {
      armed: wb.armed, queued: wb.queued, running: wb.running.map(run),
      installs: wb.installs.map(i => ({ name: i.name, running: i.running?.test ?? null, queued: i.queued, held: i.held })),
      latest: wb.latest ? { ...run(wb.latest), finishedAt: wb.latest.updatedAt, lastCase: wb.latest.lastCase, report: wb.latest.report ? reportSummary(wb.latest.report) : null, why: wb.latest.why ?? null } : null,
    }
  }

  /** What the station shows: a session's own run first (while it runs, and 10 min after), else the Workbench's queue. */
  stationView(now) {
    const st = this.station
    const own = st.status !== 'idle' && (['running', 'compiling', 'awaiting-report'].includes(st.status) || now - (st.finishedAt ?? 0) < 10 * 60_000)
    const wb = this.wbView()
    if (own || !wb) return wb ? { ...st, queue: wb } : st
    const r = wb.running[0]
    if (r) {
      const more = wb.running.length > 1 ? ` (+${wb.running.length - 1} more)` : ''
      return {
        status: 'running', kind: 'backtest', source: 'workbench', startedAt: r.startedAt ?? undefined,
        label: `Workbench ${r.test} on ${r.install}${r.planned ? ` · ${r.completed}/${r.planned}` : ''}${more}`,
        config: { expert: r.expert, symbol: r.symbol }, note: r.what || undefined, queue: wb,
      }
    }
    const l = wb.latest
    if (l && now - (l.finishedAt ?? 0) < this.config.workbenchRecentMinutes * 60_000) {
      return l.report
        ? { status: 'done', kind: 'backtest', source: 'workbench', label: `Workbench ${l.test} on ${l.install}`, startedAt: l.startedAt ?? undefined, finishedAt: l.finishedAt ?? undefined, report: l.report, config: { expert: l.expert, symbol: l.symbol }, queue: wb }
        : { status: 'report-missing', kind: 'backtest', source: 'workbench', label: `Workbench ${l.test} on ${l.install}`, finishedAt: l.finishedAt ?? undefined, note: `report not found: ${l.why ?? 'none'}`, queue: wb }
    }
    return wb.queued ? { ...st, queue: wb } : st
  }

  /** Timers: a report that turned up, waits that ran out, the reports folder rescanned, old flags dropped. */
  tick() {
    const now = this.now()
    let changed = false
    for (const [key, call] of this.calls) {
      if (call.kind !== 'report-wait') continue
      const found = this.findReport(call)
      const base = { kind: 'backtest', label: call.label, startedAt: call.at, sessionId: call.sessionId, agentId: call.agentId, ...(call.config ? { config: pickConfig(call.config) } : {}) }
      if (found.report) { this.calls.delete(key); this.reportReady(call, found.report, now, base); changed = true }
      else if (now >= call.until) { this.calls.delete(key); this.reportMissing(call, base, found.why, null, now); changed = true }
    }
    if (now - this.lastScan >= this.config.rescanSeconds * 1000) {
      this.lastScan = now
      if (this.wbDir) {
        let wb = null
        try { wb = this.readWorkbench(this.wbDir) } catch (err) { wb = { ok: false, why: String(err?.message ?? err) } }
        if (this.noteWorkbench(wb, now)) changed = true
      }
      // The wall's choices: the reports folder's newest, and the Workbench's last result
      // A deeper pool than the picker shows, so the EA being worked on is found even under a busy queue's other reports
      const list = this.config.reportsDir ? recentReports(this.config.reportsDir, { limit: POOL_MAX, look: POOL_MAX * 3 }) : []
      const extra = [this.wb?.latest?.report, this.equity?.source === 'run' ? readReportCached(this.equity.path) : null, this.pin ? readReportCached(this.pin) : null].filter(Boolean)
      this.pool = dedupeReports([...list, ...extra], this.wb?.names ?? {})
      // The picker: the newest, plus the shown and the focus EA's newest when they are older
      const top = this.pool.slice(0, CHOICES_MAX)
      const mine = this.focus ? this.pool.find(c => sameStrategy(c.report.expert ?? c.report.name, this.focus.key)) : null
      for (const c of [mine, this.pool.find(c => c.path === this.equity?.path)]) if (c && !top.includes(c)) top.push(c)
      this.choices = top
      if (this.selectEquity(now)) changed = true
    }
    // Expiry
    const screenMs = this.config.screenMinutes * 60_000
    for (const [k, s] of this.screens) if (now - s.at > screenMs) { this.screens.delete(k); changed = true }
    const riskMs = this.config.riskMinutes * 60_000
    const keep = this.risk.filter(r => now - r.at <= riskMs)
    if (keep.length !== this.risk.length) { this.risk = keep; changed = true }
    const cabMs = this.config.cabinetMinutes * 60_000
    if (this.years.size && now - this.cabinetsAt > cabMs && [...this.years.values()].every(y => y.running.size === 0)) { this.years.clear(); changed = true }
    if (changed) this.changed()
    return changed
  }

  /**
   * What the office shows. `resolve(sessionId, agentId)` names the office
   * worker of a thread (the server's lookup); `trusted: false` drops paths.
   */
  snapshot({ resolve = (sessionId, agentId) => (agentId ? null : sessionId ? `main-${sessionId}` : null), trusted = true } = {}) {
    const officeId = (o) => { try { return resolve(o.sessionId, o.agentId) ?? undefined } catch { return undefined } }
    const strip = (r) => { if (!r || trusted) return r; const { path: _p, ...rest } = r; return rest }
    const now = this.now()
    const view = this.stationView(now)
    const station = { ...view, officeId: view.source === 'workbench' ? undefined : officeId(this.station) }
    if (station.report) station.report = strip(station.report)
    return {
      station,
      runs: this.runs.slice(),
      equity: this.equity ? { ...strip(this.equity), pick: this.pin ? 'pinned' : 'auto', focus: this.focus?.expert ?? null, held: this.held } : null,
      equityChoices: this.choices.map(c => ({
        ...(trusted ? { path: c.path } : {}), name: c.report.name, expert: c.report.expert ?? null, symbol: c.report.symbol ?? null,
        period: c.report.period ?? null, mtime: c.report.mtime, netProfit: c.report.netProfit ?? null,
        file: c.file ?? basenameAny(c.path), folder: c.folder ?? reportFolder(c.path, this.wb?.names ?? {}).name, also: c.also ?? 0,
        focus: !!(this.focus && sameStrategy(c.report.expert ?? c.report.name, this.focus.key)),
      })),
      reportsDir: this.config.reportsDir ? (trusted ? this.config.reportsDir : basenameAny(this.config.reportsDir)) : null,
      cabinets: [...this.years.entries()].sort((a, b) => a[0] - b[0]).map(([year, e]) => ({ year, lastAt: e.lastAt, active: e.running.size > 0 })),
      screens: [...this.screens.values()].map(s => ({ ...s, officeId: officeId(s) })),
      risk: this.risk.map(r => ({ ...r, officeId: officeId(r) })),
      ticker: this.ticker.slice(),
      now,
    }
  }
}

function firstLine(s) { return String(s ?? '').split(/\r?\n/).map(l => l.trim()).find(Boolean)?.slice(0, 160) ?? null }

function pickConfig(c) {
  return { expert: c.expert ? basenameAny(c.expert) : null, symbol: c.symbol, period: c.period, model: c.model, modelName: c.modelName, fromDate: c.fromDate, toDate: c.toDate }
}

/** A report's numbers without its curve (what the station and the ticker show). */
export function reportSummary(r) {
  return {
    path: r.path, name: r.name, mtime: r.mtime,
    netProfit: r.netProfit, maxDrawdown: r.maxDrawdown, maxDrawdownPct: r.maxDrawdownPct, drawdownKind: r.drawdownKind,
    trades: r.trades, initialDeposit: r.initialDeposit, profitFactor: r.profitFactor, currency: r.currency,
    expert: r.expert, symbol: r.symbol, period: r.period,
  }
}

/** The state as a read-only connection gets it: report and folder paths dropped (file names kept). */
export function eaReadOnly(ea) {
  if (!ea || typeof ea !== 'object') return ea
  const strip = r => { if (!r || typeof r !== 'object') return r; const { path: _p, ...rest } = r; return rest }
  return {
    ...ea,
    station: ea.station ? { ...ea.station, report: strip(ea.station.report) } : ea.station,
    equity: strip(ea.equity),
    equityChoices: Array.isArray(ea.equityChoices) ? ea.equityChoices.map(strip) : [],
    reportsDir: ea.reportsDir ? basenameAny(ea.reportsDir) : ea.reportsDir,
  }
}

// ---------------------------------------------------------------------------
// The watcher's side: which payloads to send, and slimmed how
// ---------------------------------------------------------------------------

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write'])
const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Glob', 'Grep'])

/** Whether a rebuilt hook payload matters to the EA scenes (cheap; most do not). */
export function isEaRelevant(p) {
  if (!p || typeof p !== 'object') return false
  if (p.hook_event_name === 'SessionEnd') return true
  if (!['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(p.hook_event_name)) return false
  const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {}
  const tool = String(p.tool_name ?? '')
  if (typeof input.command === 'string') {
    if (classifyCommand(input.command)) return true
    if (/\.mq[5h]\b|\.set\b/i.test(input.command)) return p.hook_event_name === 'PreToolUse'
    return false
  }
  if (FILE_TOOLS.has(tool)) {
    const file = input.file_path ?? input.path ?? input.notebook_path
    return p.hook_event_name === 'PreToolUse' && (!!eaFileKind(file) || isTickPath(file))
  }
  return false
}

/**
 * What the watcher POSTs to /ea/payload: ids, the tool, the command or file,
 * the result's text (cut) — and for an edit, only which risk words it
 * touched, never the code.
 */
export function slimPayload(p) {
  const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {}
  const out = {
    hook_event_name: p.hook_event_name,
    session_id: p.session_id, agent_id: p.agent_id, tool_use_id: p.tool_use_id, tool_name: p.tool_name,
    tool_input: {},
  }
  for (const k of ['command', 'file_path', 'path', 'notebook_path']) if (typeof input[k] === 'string') out.tool_input[k] = input[k].slice(0, 4000)
  if (input.run_in_background === true) out.tool_input.run_in_background = true
  if (EDIT_TOOLS.has(p.tool_name) && eaFileKind(input.file_path) === 'mq5') out.risk = riskTouches(editedText(p.tool_name, input))
  if (p.hook_event_name === 'PostToolUse') out.tool_response = textOfResponse(p.tool_response).slice(-16_000)
  if (p.hook_event_name === 'PostToolUseFailure') out.error = String(p.error ?? '').slice(0, 2000)
  const at = payloadTime(p)
  if (at) out.at = at
  return out
}
