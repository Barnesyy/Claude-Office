/**
 * progression-equity.js — the demo account's equity, read from a real MT5
 * account report, for the "new demo equity high" trophy.
 *
 * Nothing here estimates, interpolates or simulates a number. The office only
 * knows an equity figure when the person points it at MT5's own report
 * export (Toolbox → History → right-click → Report → HTML, which writes
 * ReportHistory-<login>.html, UTF-16LE) or an equivalent .html/.htm/.xml file,
 * in office.config.json:
 *
 *   "progression": {
 *     "equityReports": ["C:\\Users\\Barnesy\\Documents\\MT5 reports"],   // files or folders
 *     "demoAccounts": ["5012345"]                                          // optional
 *   }
 *
 * A reading counts only when the report says it is a demo account (its
 * Account line names a "Demo" server, or the login is in demoAccounts) and
 * has an Equity figure. With no config, an unreadable file or a live account,
 * there is simply no reading and no trophy.
 */

import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { decodeText } from './progression-facts.js'

const REPORT_FILE = /\.(html?|xml)$/i

/** HTML to text: tags become cell breaks, entities decoded, whitespace squeezed per cell. */
export function htmlText(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(td|th|tr|div|p|li|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}

/** "10 234.56", "10,234.56", "-1 000.00" -> number; null when it is not a number. */
export function parseAmount(s) {
  if (typeof s !== 'string') return null
  const t = s.replace(/[\s\u00a0]/g, '')
  if (!/^-?[\d,]*\.?\d+$/.test(t)) return null
  const n = Number(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** The value that follows a "Label:" (same line, or the next cell). */
function after(lines, label) {
  // "Equity:" or "Equity" alone in its cell, never "Equity Drawdown Maximal:"
  const re = new RegExp(`^${label}\\s*(?::\\s*(.*))?$`, 'i')
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i])
    if (!m) continue
    const same = (m[1] ?? '').trim()
    if (same) return same
    return lines[i + 1]?.trim() ?? ''
  }
  return ''
}

/**
 * Read one MT5 account report.
 * @param {string} text the report's text (already decoded)
 * @param {{ demoAccounts?: string[] }} [opts]
 * @returns {{ equity: number, balance: number | null, login: string | null, demo: boolean, date: string | null } | null}
 */
export function parseAccountReport(text, { demoAccounts = [] } = {}) {
  const lines = htmlText(text).split('\n')
  // A Strategy Tester report is a simulation: its numbers are never the account's
  if (lines.some(l => /strategy tester report/i.test(l))) return null
  const equity = parseAmount(after(lines, 'Equity'))
  if (equity === null) return null
  const balance = parseAmount(after(lines, 'Balance'))
  const account = after(lines, 'Account')
  const login = /(\d{4,12})/.exec(account)?.[1] ?? null
  const demo = /demo/i.test(account) || (login !== null && demoAccounts.map(String).includes(login))
  const date = after(lines, 'Date') || null
  return { equity, balance, login, demo, date: date ? date.slice(0, 40) : null }
}

/** The report files under the configured paths (folders are read one level deep). */
export function reportFiles(paths) {
  const out = []
  for (const p of Array.isArray(paths) ? paths : []) {
    if (typeof p !== 'string' || !p) continue
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isFile()) { if (REPORT_FILE.test(p)) out.push({ path: p, mtimeMs: st.mtimeMs }) ; continue }
    if (!st.isDirectory()) continue
    let names = []
    try { names = readdirSync(p) } catch { continue }
    for (const n of names) {
      if (!REPORT_FILE.test(n)) continue
      try { const s = statSync(join(p, n)); if (s.isFile()) out.push({ path: join(p, n), mtimeMs: s.mtimeMs }) } catch {}
    }
  }
  return out
}

/**
 * The demo equity readings in the configured reports, newest file first.
 * @param {{ equityReports?: string[], demoAccounts?: string[] }} config
 */
export function readEquity(config = {}, { read = p => readFileSync(p) } = {}) {
  const files = reportFiles(config.equityReports).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 20)
  const readings = []
  for (const f of files) {
    let r = null
    try { r = parseAccountReport(decodeText(read(f.path)), { demoAccounts: config.demoAccounts }) } catch {}
    if (r && r.demo) readings.push({ ...r, file: f.path, mtimeMs: f.mtimeMs })
  }
  return readings
}
