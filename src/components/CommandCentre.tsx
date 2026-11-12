/**
 * CommandCentre — every Claude Code session as a card in four columns, the
 * way paulrobello/claude-office lays them out: Needs you (a permission
 * dialog, a question, an API error), Working, Done (its turn ended, idle)
 * and Ended. Built from the sessions the socket already has
 * (src/eaScenes.ts centreCards); opened from the title bar's CMD button,
 * closed with Esc or a click outside it.
 */

import React, { useEffect, useRef } from 'react'
import type { Agent, SessionInfo } from '../types'
import { CENTRE_COLUMNS, centreCards } from '../eaScenes'
import '../styles/ea.css'

interface Props {
  sessions: SessionInfo[]
  agents: readonly Agent[]
  onClose: () => void
  /** A click on a card: show that session's Claude */
  onPick?: (sessionId: string) => void
}

function ago(at: number | undefined): string {
  if (!at) return ''
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`
}

const CommandCentre: React.FC<Props> = ({ sessions, agents, onClose, onPick }) => {
  const cols = centreCards(sessions, agents, Date.now())
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="cc-backdrop" onClick={onClose} data-testid="command-centre">
      <div className="cc-panel" ref={ref} onClick={e => e.stopPropagation()} role="dialog" aria-label="Command Centre">
        <div className="cc-head">
          <span className="cc-title">COMMAND CENTRE</span>
          <span className="cc-count">{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
          <button type="button" className="cc-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="cc-cols">
          {CENTRE_COLUMNS.map(col => (
            <div key={col.id} className={`cc-col cc-${col.id}`}>
              <div className="cc-col-head">
                <span className="cc-dot" />{col.title}<span className="cc-n">{cols[col.id].length}</span>
              </div>
              <div className="cc-cards">
                {cols[col.id].length === 0 && <div className="cc-none">—</div>}
                {cols[col.id].map(card => (
                  <button key={card.id} type="button" className="cc-card" title={`${card.title}\n${card.line}`} onClick={() => onPick?.(card.id)}>
                    <div className="cc-card-title">{card.title}</div>
                    {card.project && card.project !== card.title && <div className="cc-card-project">{card.project}</div>}
                    <div className="cc-card-line">{card.line}</div>
                    <div className="cc-card-foot">
                      {card.workers > 0 && <span>{card.workers} worker{card.workers === 1 ? '' : 's'}</span>}
                      <span className="cc-ago">{ago(card.since)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default CommandCentre
