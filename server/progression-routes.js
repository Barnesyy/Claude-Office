/**
 * progression-routes.js — mounts the progression layer (server/progression.js)
 * on the office: the event tap, the HTTP routes and the equity poll.
 *
 *   GET  /progression                    the whole book: XP, level, trophies, milestones,
 *                                        unlocks, lessons, garden, shipped, recent gains. Open,
 *                                        like GET /recap: counts, titles and program-name labels only
 *   GET  /progression/day?date=          one day's XP by kind, awards, lessons (+ the recap's counts)
 *   GET  /progression/quarter?q=2026-Q4  the quarterly review
 *   POST /progression/facts              { facts: [...] } from the transcript watcher (office token)
 *   POST /progression/settings           { enabled } (UI token)
 *   POST /progression/reset              { confirm: "reset" } (UI token): wipes the books
 *   POST /progression/equity             re-read the configured MT5 reports now (UI token)
 *
 * Every note is wrapped so a progression failure never changes what the
 * office does with an event (the same rule as noteRecap in server/index.js).
 */

import { createProgression, isQuarter, quarterOf } from './progression.js'
import { readEquity } from './progression-equity.js'
import { isRecapDate, localDate } from './recap.js'

const MAX_FACTS = 50

/**
 * @param {import('express').Express} app
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {Function} deps.requireToken
 * @param {Function} deps.requireUi
 * @param {(payload: object) => void} deps.broadcast
 * @param {(fn: Function) => Function} deps.addEventTap
 * @param {{ get: (date: string) => object }} [deps.recap]
 * @param {() => object} [deps.readConfig] the office config (office.config.json), read when needed
 * @param {{ now?: () => number, equityPollMs?: number }} [opts]
 */
export function mountProgression(app, { db, requireToken, requireUi, broadcast, addEventTap, recap, readConfig = () => ({}) }, { now = () => Date.now(), equityPollMs } = {}) {
  const safe = (what, fn) => { try { return fn() } catch (err) { console.warn(`[progression] ${what}: ${err?.message ?? err}`) } }
  // Why the try: the store is built before the office's WebSocket server
  // exists; an award noted that early has nobody to tell yet
  const progression = createProgression(db, { now, broadcast: p => { try { broadcast(p) } catch {} } })
  const config = () => safe('config', () => readConfig()?.progression) ?? {}

  // Why a microtask: the tap runs inside broadcast(); the award it may raise
  // goes out after the event that earned it, not before
  const off = addEventTap(p => {
    if (p && typeof p.type === 'string' && !p.type.startsWith('progression_')) queueMicrotask(() => safe('tap', () => progression.noteBroadcast(p)))
  })

  if (config().enabled === false && progression.enabled()) progression.setEnabled(false)

  function pollEquity() {
    const c = config()
    if (!Array.isArray(c.equityReports) || !c.equityReports.length) return null
    return safe('equity', () => progression.noteEquity(readEquity(c)))
  }
  const pollMs = equityPollMs ?? Math.max(1, Number(config().equityPollMinutes) || 10) * 60_000
  const timer = setInterval(pollEquity, pollMs)
  timer.unref?.()
  setTimeout(pollEquity, 2000).unref?.()

  app.get('/progression', (_req, res) => {
    res.json(progression.snapshot())
  })

  app.get('/progression/day', (req, res) => {
    const date = req.query.date === undefined ? localDate(now()) : req.query.date
    if (!isRecapDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
    res.json({ ...progression.day(date), recap: recap ? safe('recap', () => recap.get(date)) ?? null : null, today: date === localDate(now()) })
  })

  app.get('/progression/quarter', (req, res) => {
    const q = req.query.q === undefined ? quarterOf(localDate(now())) : req.query.q
    if (!isQuarter(q)) return res.status(400).json({ error: 'q must be YYYY-Q1..Q4' })
    res.json(progression.quarter(q))
  })

  app.post('/progression/facts', requireToken, (req, res) => {
    const facts = Array.isArray(req.body?.facts) ? req.body.facts : req.body && typeof req.body === 'object' && req.body.kind ? [req.body] : null
    if (!facts) return res.status(400).json({ error: 'facts must be an array' })
    if (facts.length > MAX_FACTS) return res.status(413).json({ error: `at most ${MAX_FACTS} facts per request` })
    let accepted = 0
    let mt5 = false
    for (const f of facts) {
      if (safe('fact', () => progression.noteFact(f))) accepted++
      if (f?.kind === 'mt5_run') mt5 = true
    }
    // A tester run may have been followed by a fresh account report
    if (mt5) setTimeout(pollEquity, 5000).unref?.()
    res.json({ ok: true, accepted })
  })

  app.post('/progression/settings', requireUi, (req, res) => {
    const { enabled } = req.body ?? {}
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' })
    progression.setEnabled(enabled)
    console.log(`[progression] ${enabled ? 'on' : 'off'}`)
    res.json({ ok: true, enabled })
  })

  app.post('/progression/reset', requireUi, (req, res) => {
    if (req.body?.confirm !== 'reset') return res.status(400).json({ error: 'send { "confirm": "reset" } to wipe progression' })
    progression.reset()
    res.json({ ok: true })
  })

  app.post('/progression/equity', requireUi, (_req, res) => {
    const c = config()
    if (!Array.isArray(c.equityReports) || !c.equityReports.length) return res.json({ ok: true, configured: false, result: null })
    res.json({ ok: true, configured: true, result: pollEquity() ?? null })
  })

  return { progression, pollEquity, stop: () => { clearInterval(timer); off() } }
}
