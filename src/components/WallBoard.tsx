/**
 * WallBoard — the whiteboard's modes, cycling: To-do (the shown session's
 * tasks as a checklist), Kanban (TaskBoard, unchanged), Balance curve (the
 * newest real tester report's balance after each deal, src/eaScenes.ts) and
 * the EA ticker (what the station, cabinets and risk flags last said).
 *
 * The board cycles through the modes that have something to show, one every
 * WALL_CYCLE_MS; the tabs under the board pick one and hold it (a second
 * click on the held tab lets it cycle again). A picked mode with nothing to
 * show says so (the balance curve: "no tester report yet"). With nothing to
 * show in any mode and none picked it draws only the tabs, so the room's own
 * board art shows as before.
 */

import React, { useEffect, useMemo, useState } from 'react'
import TaskBoard from './TaskBoard'
import { useTheme } from '../theme'
import type { SessionInfo } from '../types'
import { BOARD_RECT, boardLabel, shownBoard, taskCaption, useTaskBoards, type BoardTask } from '../taskBoard'
import {
  WALL_CYCLE_MS, WALL_MODES, WALL_TITLES, curvePath, money, pct, useEa, wallMode, wallModesWithContent,
  type EaEquity, type EaState, type WallMode,
} from '../eaScenes'
import '../styles/taskboard.css'
import '../styles/ea.css'

interface Props {
  sessions: SessionInfo[]
  night: number
  onActivate?: () => void
}

/** The board's surface (the same rectangle and skew as TaskBoard's). */
function Surface({ children, label, title, night, theme, onClick, onHover }: { children: React.ReactNode; label: string; title: string; night: number; theme: string; onClick?: () => void; onHover?: (on: boolean) => void }) {
  return (
    <div
      className={`task-board wall-board theme-${theme}`}
      style={{ left: `${BOARD_RECT.left}%`, top: `${BOARD_RECT.top}%`, width: `${BOARD_RECT.width}%`, height: `${BOARD_RECT.height}%`, transform: `skewY(${BOARD_RECT.skewDeg}deg)` }}
      title={title}
      aria-label={title}
      role={onClick ? 'button' : 'img'}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? e => { if (e.key === 'Enter' || e.key === ' ') onClick() } : undefined}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <div className="task-board-surface" />
      {children}
      <div className="task-board-label">{label}</div>
      <div className="task-board-night" style={{ opacity: Math.max(0, Math.min(1, night)) }} aria-hidden="true" />
    </div>
  )
}

function TodoList({ tasks }: { tasks: BoardTask[] }) {
  const order = { in_progress: 0, pending: 1, completed: 2 } as const
  const sorted = [...tasks].sort((a, b) => order[a.status] - order[b.status])
  const shown = sorted.slice(0, 6)
  return (
    <div className="wall-todo">
      <div className="wall-title">To-do</div>
      {shown.map(t => (
        <div key={t.id} className={`wall-todo-row ${t.status}`}>
          <span className="wall-check">{t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : ''}</span>
          <span className="wall-todo-text">{t.status === 'in_progress' ? t.activeForm || t.subject : t.subject}</span>
        </div>
      ))}
      {sorted.length > shown.length && <div className="wall-more">+{sorted.length - shown.length} more</div>}
    </div>
  )
}

/** "Balance curve": the report's own balance points; the numbers in the corner are the report's. */
function Equity({ eq, reportsDir }: { eq: EaEquity | null; reportsDir: string | null }) {
  const curve = useMemo(() => (eq ? curvePath(eq.points, 100, 52) : null), [eq])
  if (!eq || !curve) {
    return (
      <div className="wall-equity empty">
        <div className="wall-title">Balance curve</div>
        <div className="wall-empty">No tester report yet</div>
        <div className="wall-empty-sub">{reportsDir ? `watching ${reportsDir}` : 'run the MT5 tester, or set ea.reportsDir'}</div>
      </div>
    )
  }
  const up = (eq.netProfit ?? 0) >= 0
  return (
    <div className="wall-equity">
      <div className="wall-title">{eq.expert ?? eq.name}{eq.symbol ? ` · ${eq.symbol}` : ''}</div>
      <svg viewBox="0 0 100 52" preserveAspectRatio="none" className="wall-curve" aria-hidden="true">
        {[13, 26, 39].map(y => <line key={y} x1={0} y1={y} x2={100} y2={y} stroke="#c6ccd8" strokeWidth={0.6} />)}
        <path d={curve.area} fill={up ? 'rgba(46, 160, 67, 0.16)' : 'rgba(220, 60, 50, 0.16)'} />
        <path d={curve.d} fill="none" stroke={up ? '#2e9e4a' : '#d2402f'} strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="wall-equity-stats">
        <span className={up ? 'good' : 'bad'}>{money(eq.netProfit)}</span>
        <span>DD {money(eq.maxDrawdown, { sign: false })}{eq.maxDrawdownPct !== null ? ` ${pct(eq.maxDrawdownPct)}` : ''}</span>
        <span>{eq.trades ?? '—'}t</span>
      </div>
    </div>
  )
}

function Ticker({ ticker }: { ticker: EaState['ticker'] }) {
  const lines = ticker.slice(-5).reverse()
  return (
    <div className="wall-ticker">
      <div className="wall-title">EA ticker</div>
      {lines.length === 0 && <div className="wall-empty">Nothing yet</div>}
      {lines.map((l, i) => (
        <div key={`${l.at}-${i}`} className={`wall-tick ${l.tone}`}>
          <span className="wall-tick-time">{new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span> {l.text}
        </div>
      ))}
    </div>
  )
}

/**
 * The board up close, above it while hovered: the balance curve big enough to
 * read with the report's numbers, or the ticker's lines in full.
 */
function WallZoom({ mode, ea }: { mode: 'equity' | 'ticker'; ea: EaState }) {
  const eq = ea.equity
  const curve = mode === 'equity' && eq ? curvePath(eq.points, 220, 84, 4) : null
  return (
    <div className="wall-zoom" style={{ left: `${BOARD_RECT.left + BOARD_RECT.width / 2}%`, top: `${BOARD_RECT.top - 0.6}%` }} role="tooltip" data-testid="wall-zoom">
      {mode === 'equity' && (eq && curve ? (
        <>
          <div className="wall-zoom-head">{eq.expert ?? eq.name}{eq.symbol ? ` · ${eq.symbol}` : ''}{eq.period ? ` · ${eq.period}` : ''}</div>
          <svg viewBox="0 0 220 84" className="wall-zoom-curve" aria-hidden="true">
            {[21, 42, 63].map(y => <line key={y} x1={0} y1={y} x2={220} y2={y} stroke="#2c2a1e" strokeWidth={1} />)}
            <path d={curve.area} fill={(eq.netProfit ?? 0) >= 0 ? 'rgba(126, 211, 107, 0.14)' : 'rgba(255, 122, 107, 0.14)'} />
            <path d={curve.d} fill="none" stroke={(eq.netProfit ?? 0) >= 0 ? '#7ed36b' : '#ff7a6b'} strokeWidth={1.6} strokeLinejoin="round" />
          </svg>
          <div className="wall-zoom-stats">
            <span className={(eq.netProfit ?? 0) >= 0 ? 'good' : 'bad'}>Net {money(eq.netProfit)}{eq.currency ? ` ${eq.currency}` : ''}</span>
            <span>Max {eq.drawdownKind ?? ''} DD {money(eq.maxDrawdown, { sign: false })}{eq.maxDrawdownPct !== null ? ` (${pct(eq.maxDrawdownPct)})` : ''}</span>
            <span>{eq.trades ?? '—'} trades</span>
          </div>
          <div className="wall-zoom-foot">balance after each of {eq.dealCount} deals · {eq.name}{eq.source === 'folder' ? ' (reports folder)' : ''}</div>
        </>
      ) : (
        <div className="wall-zoom-head">No tester report yet{ea.reportsDir ? ` (watching ${ea.reportsDir})` : ''}</div>
      ))}
      {mode === 'ticker' && (
        <>
          <div className="wall-zoom-head">EA ticker</div>
          {ea.ticker.length === 0 && <div className="wall-zoom-foot">nothing yet</div>}
          {ea.ticker.slice(-8).reverse().map((t, i) => (
            <div key={`${t.at}-${i}`} className={`wall-zoom-tick ${t.tone}`}>
              <span className="wall-tick-time">{new Date(t.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span> {t.text}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function equityTitle(eq: EaEquity | null): string {
  if (!eq) return 'Balance curve: no tester report yet'
  return `Balance after each deal — ${eq.name}${eq.source === 'folder' ? ' (newest in the reports folder)' : ''}: net ${money(eq.netProfit)}, max ${eq.drawdownKind ?? ''} drawdown ${money(eq.maxDrawdown, { sign: false })}${eq.maxDrawdownPct !== null ? ` (${pct(eq.maxDrawdownPct)})` : ''}, ${eq.trades ?? '—'} trades, ${eq.dealCount} deals plotted`
}

function previewWall(): WallMode | null {
  const v = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('wall') : null
  return v && (WALL_MODES as readonly string[]).includes(v) ? (v as WallMode) : null
}

const WallBoard: React.FC<Props> = ({ sessions, night, onActivate }) => {
  const ea = useEa()
  const boards = useTaskBoards()
  const theme = useTheme()
  // ?wall=equity (todo, kanban, ticker) holds a mode from the start, like ?screens=
  const [picked, setPicked] = useState<WallMode | null>(() => previewWall())
  const [turn, setTurn] = useState(0)
  const [hover, setHover] = useState(false)
  const board = shownBoard(boards)
  const withContent = wallModesWithContent(!!board, ea)
  const cycling = !picked && withContent.length > 1
  useEffect(() => {
    if (!cycling) return
    const id = setInterval(() => setTurn(t => t + 1), WALL_CYCLE_MS)
    return () => clearInterval(id)
  }, [cycling])
  const mode = wallMode(picked, withContent, turn)

  const pick = (m: WallMode) => setPicked(p => (p === m ? null : m))
  let body: React.ReactNode = null
  if (mode === 'kanban') body = <TaskBoard sessions={sessions} night={night} onActivate={onActivate} />
  else if (mode === 'todo') {
    body = (
      <Surface theme={theme} night={night} onClick={onActivate}
        label={board ? boardLabel(board, sessions, boards.boards.indexOf(board), boards.boards.length) : 'no tasks'}
        title={board ? board.tasks.map(t => taskCaption(t, board)).join('\n') : 'To-do: no session has tasks'}>
        {board ? <TodoList tasks={board.tasks} /> : <div className="wall-todo"><div className="wall-title">To-do</div><div className="wall-empty">No tasks</div></div>}
      </Surface>
    )
  } else if (mode === 'equity') {
    body = (
      <Surface theme={theme} night={night} label={ea.equity ? `${ea.equity.dealCount} deals` : ''} title={equityTitle(ea.equity)} onHover={setHover}>
        <Equity eq={ea.equity} reportsDir={ea.reportsDir} />
      </Surface>
    )
  } else if (mode === 'ticker') {
    body = (
      <Surface theme={theme} night={night} label="" title={ea.ticker.slice(-12).map(t => t.text).join('\n') || 'EA ticker: nothing yet'} onHover={setHover}>
        <Ticker ticker={ea.ticker} />
      </Surface>
    )
  }

  return (
    <>
      {body}
      {hover && (mode === 'equity' || mode === 'ticker') && <WallZoom mode={mode} ea={ea} />}
      <div
        className="wall-tabs"
        style={{ left: `${BOARD_RECT.left}%`, top: `${BOARD_RECT.top + BOARD_RECT.height + 0.5}%`, width: `${BOARD_RECT.width}%`, transform: `skewY(${BOARD_RECT.skewDeg}deg)` }}
        role="tablist"
        aria-label="Whiteboard modes"
      >
        {WALL_MODES.map(m => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`wall-tab${mode === m ? ' on' : ''}${picked === m ? ' held' : ''}${withContent.includes(m) ? '' : ' empty'}`}
            title={`${WALL_TITLES[m]}${picked === m ? ' (held: click to cycle again)' : ''}`}
            onClick={e => { e.stopPropagation(); pick(m) }}
            data-testid={`wall-tab-${m}`}
          >
            {m === 'todo' ? 'TODO' : m === 'kanban' ? 'KAN' : m === 'equity' ? 'EQ' : 'TICK'}
          </button>
        ))}
      </div>
    </>
  )
}

export default WallBoard
