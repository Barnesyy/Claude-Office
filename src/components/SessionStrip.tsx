/**
 * SessionStrip — one pill per Claude Code session (terminal) in the title bar.
 *
 * Each pill shows the session's title (after /rename) or project (basename
 * of its cwd), a model badge, how many workers it has in the office, and a
 * dot for what its Claude is doing: green/pulsing while a turn is running,
 * blue while the turn is over but background workers are still out (with
 * the count), amber "needs you" while it waits on a permission or input,
 * red on an API error, purple during a memory wipe, dim when idle, struck
 * through once the session ends. The main state comes from the session's
 * Claude in the office (src/officeReducer.ts), falling back to the server's
 * `main` record. Two terminals = two pills. Nothing renders while no
 * session is known.
 *
 * A session only Claude Code's session registry knows (`hooked: false`: the
 * hooks are not installed, or not in that terminal) is a grey, dashed pill
 * labelled with its registry name; its dot follows the registry status (busy,
 * shell, idle, waiting — the word is the dot's tooltip) and the pill's tooltip
 * says how to hook it. It has no Claude in the office.
 *
 * Project focus (EA fork): the transcript watcher labels a session
 * "<project> · <sub folder>" (office.config.json `transcripts`). Pills are
 * grouped by the part before " · ", one small heading per group once there
 * is more than one, and a titled session keeps a chip with its project.
 */

import React, { useEffect, useState } from 'react'
import { Agent, SessionInfo } from '../types'
import { mainId, isMainAgent, mainTone, mainPillText, shortModel, projectFromCwd, type PillTone } from '../mainState'

// Main-thread activity counts as "busy" for this long after the last tool call
// (only used while no main record has arrived — an old server)
const BUSY_WINDOW_MS = 10_000

/** The first line of an unhooked pill's tooltip: how to see what the session is doing */
export const NOT_HOOKED_HINT = 'Not seen yet — the transcript watcher (scripts/transcript-watch.mjs, started by start-office) shows what it is doing; or opt in to hooks with `npm run install-hooks`'

interface SessionStripProps {
  sessions: SessionInfo[]
  agents: Agent[]
}

/** What the pill is labelled: the title, the registry name for an unhooked session, else the project */
export function pillLabel(session: SessionInfo): string {
  if (session.title) return session.title
  if (session.hooked === false) return session.registry?.name ?? session.project ?? projectFromCwd(session.cwd) ?? session.id.slice(0, 8)
  return session.project ?? session.id.slice(0, 8)
}

/** The project group of a session: its label up to " · " ("EA Dev · School Run" -> "EA Dev") */
export function projectGroup(session: SessionInfo): string {
  const label = session.project ?? projectFromCwd(session.cwd) ?? ''
  const cut = label.indexOf(' · ')
  return cut >= 0 ? label.slice(0, cut) : label
}

function describe(session: SessionInfo, claude: Agent | undefined, workerCount: number, workingCount: number): string {
  const mainState = claude?.mainState ?? session.main?.state
  const unhooked = session.hooked === false
  const lines = [
    unhooked ? NOT_HOOKED_HINT : null,
    pillLabel(session),
    session.title && session.project ? `project: ${session.project}` : null,
    unhooked && session.registry?.name && session.project && session.registry.name !== session.project ? `project: ${session.project}` : null,
    session.cwd ? `cwd: ${session.cwd}` : null,
    session.model || claude?.model ? `model: ${session.model ?? claude?.model}` : null,
    session.source ? `started: ${session.source}` : null,
    unhooked
      ? (session.registry?.status ? `claude: ${session.registry.status} (registry)` : null)
      : mainState ? `claude: ${mainState}${claude?.statusText ? ` — ${claude.statusText}` : ''}` : session.lastStatus ? `claude: ${session.lastStatus}` : null,
    session.registry ? `pid ${session.registry.pid}${session.registry.version ? ` · Claude Code ${session.registry.version}` : ''}` : null,
    unhooked ? null : `workers: ${workerCount} (${workingCount} working)`,
    session.state === 'ended' ? `ended${session.reason ? ` (${session.reason})` : ''}` : null,
    `session ${session.id}`,
  ]
  return lines.filter(Boolean).join('\n')
}

const SessionStrip: React.FC<SessionStripProps> = ({ sessions, agents }) => {
  // Re-render once a second so the legacy busy dot goes idle after BUSY_WINDOW_MS
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (sessions.length === 0) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [sessions.length])

  if (sessions.length === 0) return null

  // Why the group's first start: groups keep their place as sessions come and go
  const groupStart = new Map<string, number>()
  for (const s of sessions) {
    const g = projectGroup(s)
    groupStart.set(g, Math.min(groupStart.get(g) ?? Infinity, s.startedAt ?? 0))
  }
  const ordered = [...sessions].sort((a, b) =>
    (groupStart.get(projectGroup(a))! - groupStart.get(projectGroup(b))!) ||
    projectGroup(a).localeCompare(projectGroup(b)) ||
    (a.state === 'ended' ? 1 : 0) - (b.state === 'ended' ? 1 : 0) || (a.startedAt ?? 0) - (b.startedAt ?? 0))
  const grouped = groupStart.size > 1

  return (
    <div className="session-strip" aria-label="Claude Code sessions">
      {ordered.map((session, i) => {
        const group = projectGroup(session)
        const heading = grouped && group && (i === 0 || projectGroup(ordered[i - 1]) !== group)
        const unhooked = session.hooked === false
        const claude = agents.find(a => a.id === mainId(session.id) && a.state !== 'completed')
        const mine = agents.filter(a => a.sessionId === session.id && a.state !== 'completed' && !isMainAgent(a))
        const working = mine.filter(a => a.state === 'working')
        const ended = session.state === 'ended'
        const mainState = claude?.mainState ?? session.main?.state
        const needsYou = claude?.needsYou ?? session.main?.needsYou
        const waitingOn = claude?.waitingOn ?? session.main?.waitingOn
        let tone: PillTone = ended ? 'ended' : mainTone(mainState, needsYou)
        // No main record yet (old server): busy while a worker types or Claude just used a tool
        if (!ended && mainState === undefined) {
          const mainThreadBusy = !!session.lastStatusAt && now - session.lastStatusAt < BUSY_WINDOW_MS
          if (working.length > 0 || mainThreadBusy) tone = 'busy'
        }
        const stateText = ended ? null : mainPillText(mainState, needsYou, waitingOn)
        const model = shortModel(session.model ?? claude?.model)
        const registryStatus = session.registry?.status

        const label = pillLabel(session)
        // Why: a titled session hides its project label, so it keeps a chip; a label that
        // already says the sub folder ("EA Dev · School Run") drops the group the heading shows
        const chip = session.title && session.project ? group || session.project : null
        const shown = !session.title && grouped && label.startsWith(`${group} · `) ? label.slice(group.length + 3) : label

        return (
          <React.Fragment key={session.id}>
          {heading && <span className="session-group" data-project={group} title={`project: ${group}`}>{group}</span>}
          <div
            className={`session-pill ${tone}${unhooked ? ' unhooked' : ''}`}
            title={describe(session, claude, mine.length, working.length)}
            data-session-id={session.id}
            data-main-state={mainState ?? ''}
            data-hooked={unhooked ? 'false' : 'true'}
          >
            <span className={`session-dot ${tone}`} title={unhooked && registryStatus ? registryStatus : undefined} />
            {chip && <span className="session-pill-chip" title={`project: ${session.project}`}>{chip}</span>}
            <span className="session-pill-project">{shown}</span>
            {model && <span className="session-pill-model" title={`model: ${session.model ?? claude?.model}`}>{model}</span>}
            {unhooked
              ? <span className="session-pill-unhooked" title={NOT_HOOKED_HINT}>not hooked</span>
              : <span className="session-pill-count" title={`${mine.length} worker${mine.length === 1 ? '' : 's'}`}>{mine.length}</span>}
            {stateText && <span className={`session-pill-state ${tone}`}>{stateText}</span>}
          </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

export default SessionStrip
