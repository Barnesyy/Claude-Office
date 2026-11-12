/**
 * EaScene — the EA-development corner of the office (src/eaScenes.ts):
 *
 *   backtest station  a server rack and a crash cart by the left wall. The
 *                     rack's LEDs chase while the strategy tester runs, sweep
 *                     blue while MetaEditor compiles, hold green on a report
 *                     or a clean compile, flash red on compile errors or a
 *                     failed run, glow amber while a report is awaited or was
 *                     not found. The cart's monitor shows the tester. A card
 *                     above says what happened: the report's own net profit,
 *                     max drawdown and trades, or "report not found".
 *   tick archive      filing cabinets along the window wall, a brass plate
 *                     with the year (or years) each holds; a cabinet stands
 *                     open while a tick-data tool works on its years.
 *   risk badges       an amber flag over the desk of a worker whose edit
 *                     touched lot sizing, risk or stop-loss code (info only).
 *
 * Sprites are the upstream MIT ones (server rack, crash cart, filing cabinet)
 * placed like FurnitureRenderer places furniture; the LEDs and the monitor
 * are drawn over them in SVG in the sprites' own pixels, like DeskScreens.
 */

import React, { useEffect, useReducer } from 'react'
import ResilientImg from './ResilientImg'
import { ASSETS } from '../assets'
import { StrategyTester } from './EaScreens'
import {
  cabinets as cabinetList, elapsed, money, queueLines, reportLines, riskByWorker, riskCaption, stationHeadline, stationLights, useEa,
  type EaStation, type Lights,
} from '../eaScenes'
import type { Agent } from '../types'
import { useProgression, isUnlocked } from '../progression'
import '../styles/ea.css'

const MOVE = !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

/** Where the station stands, in % of the room (feet of each sprite) */
export const STATION_SPOTS = Object.freeze({ rack: { x: 13.6, y: 60.2 }, cart: { x: 8.6, y: 67.6 } })
/** The tick cabinets along the window wall, left to right (feet), at most this many */
export const CABINET_SPOTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 19.2, y: 54.7 }, { x: 22.6, y: 52.4 }, { x: 26.0, y: 50.1 },
]

/** Where a risk flag floats from its worker's desk spot (% of the room): beside the head, clear of its bubbles */
const RISK_OFFSET = { x: 3.6, y: -12.5 }

// The rack sprite's LEDs (server-rack-1.webp, 133 x 250): two columns of eleven
const LEDS: Array<[number, number]> = [
  ...Array.from({ length: 11 }, (_, i) => [68.6, 72 + i * 14.4] as [number, number]),
  ...Array.from({ length: 11 }, (_, i) => [114.3, 50 + i * 14.5] as [number, number]),
]
const LIGHT: Record<Exclude<Lights, 'off'>, string> = { run: '#4ade80', compile: '#38bdf8', green: '#22c55e', red: '#ef4444', amber: '#f59e0b' }

function RackLeds({ lights }: { lights: Lights }) {
  if (lights === 'off') return null
  const c = LIGHT[lights]
  return (
    <svg className="ea-rack-leds" viewBox="0 0 133 250" preserveAspectRatio="none" aria-hidden="true">
      {LEDS.map(([x, y], i) => {
        // Why these rates: a chase that reads as disk / network activity, not a strobe (max 2.5 Hz)
        const dur = lights === 'run' ? `${0.5 + ((i * 7) % 5) * 0.18}s` : lights === 'compile' ? '1.6s' : lights === 'red' ? '1s' : '2.4s'
        const begin = lights === 'compile' ? `${(i % 11) * 0.12}s` : `${((i * 3) % 7) * 0.11}s`
        const fill = lights === 'run' && i % 4 === 3 ? '#facc15' : c
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={5.5} fill={fill} opacity={0.28} />
            <rect x={x - 2.6} y={y - 2.6} width={5.2} height={5.2} fill={fill}>
              {MOVE && lights !== 'green' && (
                <animate attributeName="opacity" values={lights === 'amber' ? '1;0.35;1' : '1;0.15;1'} dur={dur} begin={begin}
                  calcMode={lights === 'run' || lights === 'red' ? 'discrete' : 'linear'} repeatCount="indefinite" />
              )}
            </rect>
          </g>
        )
      })}
    </svg>
  )
}

// The crash cart's monitor face (crash-cart.webp, 110 x 160), as DeskScreens' ScreenQuad
const CART_SCREEN = { x0: 36, y0: 21.5, x1: 68, y1: 7.5, h: 23 }

function CartMonitor({ lights }: { lights: Lights }) {
  if (lights === 'off') return null
  const q = CART_SCREEN
  const tone = lights === 'run' ? 'run' : lights === 'red' ? 'bad' : lights === 'green' ? 'good' : 'idle'
  return (
    <svg className="ea-cart-screen" viewBox="0 0 110 160" preserveAspectRatio="none" aria-hidden="true">
      <clipPath id="ea-cart-clip"><rect width={100} height={100} /></clipPath>
      <g transform={`matrix(${(q.x1 - q.x0) / 100} ${(q.y1 - q.y0) / 100} 0 ${q.h / 100} ${q.x0} ${q.y0})`} clipPath="url(#ea-cart-clip)">
        <StrategyTester tone={tone} />
        {lights === 'compile' && <rect width={100} height={100} fill="#1e2433" opacity={0.85} />}
        {lights === 'amber' && <rect width={100} height={100} fill="#f59e0b" opacity={0.18} />}
      </g>
    </svg>
  )
}

/** Re-renders every second while `on` (the running timer). */
function useSecondTick(on: boolean) {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [on])
}

const ICON = { ok: '/sprites/trading/ea/compile-ok.png', error: '/sprites/trading/ea/compile-error.png', risk: '/sprites/trading/ea/risk-flag.png', ticks: '/sprites/trading/ea/tick-archive.png' }

function StationCard({ s }: { s: EaStation }) {
  const running = s.status === 'running' || s.status === 'compiling' || s.status === 'awaiting-report'
  useSecondTick(running)
  const queue = queueLines(s.queue)
  if (s.status === 'idle') {
    // Nothing of a session's own on the station, but the Workbench queue has runs waiting: say so, quietly
    if (!s.queue || !s.queue.queued) return null
    return (
      <div className="ea-card ea-card-off" title={queue.join('\n')} data-testid="ea-station-card" data-status="idle" data-source="workbench">
        <div className="ea-card-head"><span className="ea-card-title">EA Workbench: idle</span></div>
        <div className="ea-card-queue">{queue.map(l => <div key={l}>{l}</div>)}</div>
      </div>
    )
  }
  const lines = s.status === 'done' ? reportLines(s.report) : null
  const lights = stationLights(s)
  const icon = lights === 'green' ? ICON.ok : lights === 'red' ? ICON.error : null
  const title = [
    stationHeadline(s),
    s.label && s.label !== stationHeadline(s) ? s.label : null,
    s.config?.modelName ? `model: ${s.config.modelName}` : null,
    s.config?.fromDate ? `${s.config.fromDate} – ${s.config.toDate ?? ''}` : null,
    s.report?.path ?? s.report?.name ?? null,
    s.note ?? null,
    s.error ? `error: ${s.error}` : null,
    ...(queue.length ? ['EA Workbench queue:', ...queue] : []),
    s.queue?.latest?.report ? `last result ${s.queue.latest.test}${s.queue.latest.lastCase ? ` (${s.queue.latest.lastCase})` : ''}: net ${money(s.queue.latest.report.netProfit)}, ${s.queue.latest.report.trades ?? '—'} trades` : null,
  ].filter(Boolean).join('\n')
  return (
    <div className={`ea-card ea-card-${lights}`} title={title} data-testid="ea-station-card" data-status={s.status} data-source={s.source ?? 'session'}>
      <div className="ea-card-head">
        {icon && <img src={icon} alt="" className="ea-card-icon" draggable={false} />}
        <span className="ea-card-title">{stationHeadline(s)}</span>
        {running && s.startedAt ? <span className="ea-card-clock">{elapsed(Date.now() - s.startedAt)}</span> : null}
      </div>
      {lines && (
        <div className="ea-card-stats">
          <span className={`ea-net ${lines.tone}`}>Net {lines.net}</span>
          <span>DD {lines.dd}</span>
          <span>{lines.trades} trades</span>
        </div>
      )}
      {s.status === 'report-missing' || s.status === 'failed' ? <div className="ea-card-note">{(s.note ?? 'report not found').replace(/^report not found: /, '')}</div> : null}
      {s.status === 'compile-error' || s.status === 'compile-ok' ? (
        <div className="ea-card-note">{s.compile?.errors ?? '?'} errors, {s.compile?.warnings ?? '?'} warnings</div>
      ) : null}
      {s.status === 'compile-unknown' && <div className="ea-card-note">{s.note}</div>}
      {s.source === 'workbench' && queue.length > 0 && <div className="ea-card-queue">{queue.slice(0, 3).map(l => <div key={l}>{l}</div>)}</div>}
    </div>
  )
}

function Sprite({ id, x, y, z, children, className = '' }: { id: string; x: number; y: number; z?: number; children?: React.ReactNode; className?: string }) {
  const asset = ASSETS[id]
  return (
    <div className={`ea-sprite ${className}`} style={{ left: `${x}%`, top: `${y}%`, zIndex: z ?? Math.round(y) }}>
      <ResilientImg src={asset.path} alt="" draggable={false}
        style={{ height: asset.height, width: 'auto', display: 'block', imageRendering: 'pixelated', filter: 'drop-shadow(0 0 0.5px #000) drop-shadow(0 0 0.5px #000)' }} />
      {children}
    </div>
  )
}

interface Props {
  /** The office's agents (for the risk badges over their desks) */
  agents: readonly Agent[]
}

const EaScene: React.FC<Props> = ({ agents }) => {
  const ea = useEa()
  const s = ea.station
  const lights = stationLights(s)
  const cabs = cabinetList(ea.cabinets, CABINET_SPOTS.length)
  const risks = riskByWorker(ea)
  // With progression on, the crash cart is the "backtest bay" unlock: until it
  // is earned its dust sheet stands there (ProgressionLayer). The rack and its
  // card always show, so a live run is never hidden behind a lock.
  const prog = useProgression().snapshot
  const cartShown = !prog?.enabled || isUnlocked(prog, 'backtest-bay')
  return (
    <>
      {/* The tick archive */}
      {cabs.map((c, i) => {
        const spot = CABINET_SPOTS[i]
        return (
          <Sprite key={c.label} id={c.active ? 'filing-open' : 'filing-closed'} x={spot.x} y={spot.y} className={`ea-cabinet${c.active ? ' active' : ''}`}>
            <div className="ea-plate" title={`Tick data: ${c.years.join(', ')}${c.active ? ' (a tick-data tool is working on it)' : ''}`}>
              {c.active && <img src={ICON.ticks} alt="" draggable={false} />}{c.label}
            </div>
          </Sprite>
        )
      })}

      {/* The backtest station */}
      <Sprite id="server-rack-1" x={STATION_SPOTS.rack.x} y={STATION_SPOTS.rack.y} className={`ea-rack lights-${lights}`}>
        <RackLeds lights={lights} />
        <StationCard s={s} />
      </Sprite>
      {cartShown && (
        <Sprite id="crash-cart" x={STATION_SPOTS.cart.x} y={STATION_SPOTS.cart.y} className="ea-cart">
          <CartMonitor lights={lights} />
        </Sprite>
      )}

      {/* Risk flags over desks */}
      {agents.map(a => {
        const r = risks[a.id]
        if (!r) return null
        return (
          <div key={`risk-${a.id}`} className="ea-risk" style={{ left: `${a.deskPosition.x + RISK_OFFSET.x}%`, top: `${a.deskPosition.y + RISK_OFFSET.y}%` }}
            title={riskCaption(r)} data-testid="ea-risk-badge" role="img" aria-label={riskCaption(r)}>
            <img src={ICON.risk} alt="" draggable={false} />
            <span>{r.categories.map(c => (c === 'lot sizing' ? 'LOTS' : c === 'stop-loss' ? 'SL' : 'RISK')).join('·')}</span>
          </div>
        )
      })}
    </>
  )
}

export default EaScene
