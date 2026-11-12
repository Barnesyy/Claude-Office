/**
 * ea-office.js — the EA scenes (server/ea-scenes.js) wired into the office:
 *
 *   POST /ea/payload   the transcript watcher's slimmed hook payloads
 *                      ({ payloads: [...] } or one payload), office token required
 *   GET  /ea/state     the current state (paths only with the office token)
 *   `ea_state`         broadcast with the whole state after every change; the
 *                      WS snapshot carries it as `ea`
 *
 * A 2 s timer (unref'd) lets a detached tester run's report turn up, rescans
 * the reports folder and retires old badges. Nothing here writes a file or
 * starts a process.
 */

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
export function mountEaScenes({ app, requireToken, isTrusted = () => false, broadcast, resolve, officeConfig = {}, env = process.env, tickMs = 2000 }) {
  const config = resolveEaConfig(officeConfig, env)
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
  const scenes = new EaScenes({ config, onChange: send })

  app.post('/ea/payload', requireToken, (req, res) => {
    const body = req.body
    const list = Array.isArray(body?.payloads) ? body.payloads.slice(0, MAX_PAYLOADS) : body && typeof body === 'object' ? [body] : []
    let changed = 0
    for (const p of list) { try { if (scenes.note(p)) changed++ } catch (err) { console.warn(`[ea] payload skipped: ${err?.message ?? err}`) } }
    res.json({ ok: true, changed })
  })

  app.get('/ea/state', (req, res) => res.json(snapshot(isTrusted(req))))

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
