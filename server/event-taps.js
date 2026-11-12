/**
 * event-taps.js — where a progression layer (XP, trophies, milestones,
 * the lessons binder, quarterly review...) plugs into the office.
 *
 * Every payload the office broadcasts to its pages (after the server has
 * applied it: agent_spawned, agent_completed, session_prompt,
 * session_turn_end, session_needs_you, signal (deploy/build/test/push),
 * incident_*, ...) is handed to each tap, synchronously, in order. Events
 * that came from the hookless transcript watcher carry `via: 'transcript'`
 * on the event the watcher POSTed; the broadcast keeps what the server
 * built from it.
 *
 *   import { addEventTap } from './event-taps.js'
 *   const off = addEventTap(event => progression.note(event))
 *
 * A tap must be cheap and must not throw (a throw is caught and logged once
 * per tap, and never stops the broadcast). A tap that wants to show
 * something can broadcast its own event type through the office's own
 * broadcast (server/index.js exports it), e.g. { type: 'progression_award' }.
 */

const taps = new Set()
const warned = new WeakSet()

/** Register a tap; returns a function that removes it. */
export function addEventTap(fn) {
  if (typeof fn !== 'function') throw new TypeError('addEventTap needs a function')
  taps.add(fn)
  return () => taps.delete(fn)
}

export function removeEventTap(fn) { taps.delete(fn) }

/** Called by broadcast() for every outgoing payload. */
export function notifyTaps(payload) {
  for (const fn of taps) {
    try { fn(payload) } catch (err) {
      if (!warned.has(fn)) { warned.add(fn); console.warn(`[event-taps] a tap threw: ${err?.message ?? err}`) }
    }
  }
}

export function tapCount() { return taps.size }
