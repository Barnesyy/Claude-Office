/**
 * ea-office.js — the EA scenes (server/ea-scenes.js) wired into the office:
 *
 *   POST /ea/payload   the transcript watcher's slimmed hook payloads
 *                      ({ payloads: [...] } or one payload), office token required
 *   GET  /ea/state     the current state (paths only with the office token)
 *   POST /ea/equity/pin  { path } picks the equity wall's report (one the state lists), { path: null }
 *                      goes back to automatic; the page's UI token. Kept in <home>/ea-equity.json
 *   `ea_state`         broadcast with the whole state after every change; the
 *                      WS snapshot carries it as `ea`
 *
 * A 2 s timer (unref'd) lets a detached tester run's report turn up, rescans
 * the reports folder, reads the EA Workbench run queue (read-only) and retires
 * old badges. The only file written is the pin (ea-equity.json, in the office's
 * own folder); nothing here starts a process.
 */

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { EaScenes, resolveEaConfig, eaReadOnly } from './ea-scenes.js'

const MAX_PAYLOADS = 50

/**
 * @param {object} o
 * @param {import('express').Express} o.app
 * @param {Function} o.requireToken the office's bearer-token middleware
 * @param {(req: object) => boolean} o.isTrusted whether a GET carries the office token
 * @param {(payload: object) => void} o.broadcast
 * @param {(sessionId?: string, agentId?: string) => string | null} o.resolve the office id of a thread
 * @param {object} [o.officeConfig] office.config.json
 * @param {NodeJS.ProcessEnv} [o.env]
 * @param {number} [o.tickMs]
 */
export function mountEaScenes({ app, requireToken, requireUi = requireToken, isTrusted = () => false, broadcast, resolve, officeConfig = {}, env = process.env, tickMs = 2000, stateDir = null }) {
  const config = resolveEaConfig(officeConfig, env)
  const pinFile = stateDir ? join(stateDir, 'ea-equity.json') : null
  let pin = null
  try { if (pinFile) pin = JSON.parse(readFileSync(pinFile, 'utf8'))?.pin ?? null } catch {}
  const savePin = p => { if (!pinFile) return; try { writeFileSync(pinFile, JSON.stringify({ pin: p }), { mode: 0o600 }) } catch {} }
  const snapshot = (trusted = true) => {
    const state = scenes.snapshot({ resolve, trusted: true })
    return trusted ? state : eaReadOnly(state)
  }
  // Which office worker each thread is: a worker's subagent id is linked a
  // moment after its first tool call may arrive, so the timer re-sends the
  // state when a link turns up
  let lastIds = ''
  const idsOf = state => JSON.stringify([state.station.officeId, ...state.screens.map(s => s.officeId), ...state.risk.map(r => r.officeId)])
  const send = () => { const state = snapshot(true); lastIds = idsOf(state); broadcast({ type: 'ea_state', ea: state }) }
  const scenes = new EaScenes({ config, onChange: send, pin, onPin: savePin })

  app.post('/ea/payload', requireToken, (req, res) => {
    const body = req.body
    const list = Array.isArray(body?.payloads) ? body.payloads.slice(0, MAX_PAYLOADS) : body && typeof body === 'object' ? [body] : []
    let changed = 0
    for (const p of list) { try { if (scenes.note(p)) changed++ } catch (err) { console.warn(`[ea] payload skipped: ${err?.message ?? err}`) } }
    res.json({ ok: true, changed })
  })

  app.get('/ea/state', (req, res) => res.json(snapshot(isTrusted(req))))

  app.post('/ea/equity/pin', requireUi, (req, res) => {
    const p = req.body?.path
    if (p !== null && p !== undefined && typeof p !== 'string') return res.status(400).json({ error: 'path must be a string or null' })
    const ok = scenes.setPin(p ?? null)
    if (!ok) return res.status(404).json({ error: 'not one of the listed reports' })
    res.json({ ok: true, pin: scenes.pin })
  })

  // The first scan of the reports folder, then the timer
  try { scenes.tick() } catch {}
  const timer = setInterval(() => {
    try {
      if (!scenes.tick() && idsOf(snapshot(true)) !== lastIds) send()
    } catch (err) { console.warn(`[ea] tick: ${err?.message ?? err}`) }
  }, tickMs)
  timer.unref?.()

  return { scenes, config, snapshot, stop: () => clearInterval(timer) }
}
