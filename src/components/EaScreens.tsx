/**
 * EaScreens — the EA-development monitor pictures, drawn in the same 100 x 100
 * screen box and SMIL style as DeskScreens.tsx (which maps them onto a
 * monitor's slanted face; the backtest station's crash-cart monitor uses the
 * tester one too):
 *
 *   dax     a DAX40 M15 candle chart, the last candle ticking, a bid line
 *   mql     MetaEditor: the navigator, MQL5 code, the toolbox's green
 *           "0 errors" line
 *   tester  the MT5 strategy tester: a progress bar filling, a balance line
 *           drawing itself
 *
 * These are pictures of the apps, not data: no price or result is drawn on
 * them (the station's readout and the wall carry the report's real numbers).
 */

import React from 'react'

// Why: a static picture instead of motion when the viewer asks for less
const MOVE = !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

// A fixed shape of candles: [open, close, high, low] in screen units (y down)
const CANDLES: Array<[number, number, number, number]> = [
  [62, 56, 53, 66], [56, 58, 52, 61], [58, 50, 47, 60], [50, 52, 46, 55], [52, 44, 41, 54],
  [44, 47, 40, 50], [47, 40, 36, 49], [40, 43, 37, 46], [43, 36, 33, 45], [36, 38, 31, 41],
  [38, 32, 28, 40], [32, 35, 29, 38],
]

/** DAX40 M15: green and red candles on a dark chart, the last one ticking up and down. */
export function DaxChart() {
  const w = 6
  return (
    <>
      <rect width={100} height={100} fill="#0a0f1a" />
      {/* grid */}
      {[20, 40, 60, 80].map(y => <line key={y} x1={0} y1={y} x2={100} y2={y} stroke="#1c2a40" strokeWidth={1} />)}
      {[25, 50, 75].map(x => <line key={x} x1={x} y1={8} x2={x} y2={100} stroke="#1c2a40" strokeWidth={1} />)}
      {/* the symbol tab: DAX40 · M15 as two chips */}
      <rect x={3} y={2} width={20} height={5} fill="#facc15" />
      <rect x={25} y={2} width={10} height={5} fill="#64748b" />
      {CANDLES.map(([o, c, hi, lo], i) => {
        const x = 5 + i * 7.6
        const up = c < o
        const colour = up ? '#22c55e' : '#ef4444'
        const last = i === CANDLES.length - 1
        return (
          <g key={i}>
            <line x1={x + w / 2} y1={hi + 10} x2={x + w / 2} y2={lo + 10} stroke={colour} strokeWidth={1.4} />
            <rect x={x} y={Math.min(o, c) + 10} width={w} height={Math.max(2, Math.abs(o - c))} fill={colour}>
              {MOVE && last && <animate attributeName="height" values="3;7;4;9;5;3" dur="2.6s" repeatCount="indefinite" />}
              {MOVE && last && <animate attributeName="y" values={`${c + 10};${c + 6};${c + 9};${c + 4};${c + 8};${c + 10}`} dur="2.6s" repeatCount="indefinite" />}
            </rect>
          </g>
        )
      })}
      {/* the bid line and its price chip */}
      <g>
        {MOVE && <animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 -1;0 -6;0 -2;0 0" dur="2.6s" repeatCount="indefinite" />}
        <line x1={0} y1={45} x2={88} y2={45} stroke="#38bdf8" strokeWidth={1} strokeDasharray="3 2" />
        <rect x={88} y={42} width={12} height={6} fill="#38bdf8" />
      </g>
      {/* a 20-period average under the candles */}
      <polyline points="2,74 15,70 28,66 41,62 54,57 67,53 80,49 96,46" fill="none" stroke="#fbbf24" strokeWidth={1.2} opacity={0.85} />
    </>
  )
}

/** MetaEditor: a navigator pane, MQL5 code scrolling, the toolbox's compile line at the bottom. */
export function MetaEditor() {
  const lines: Array<[number, number, string]> = [
    [0, 30, '#93c5fd'], [0, 52, '#e2e8f0'], [1, 40, '#86efac'], [1, 58, '#e2e8f0'], [2, 34, '#fde68a'], [1, 22, '#93c5fd'],
    [0, 12, '#e2e8f0'], [0, 44, '#93c5fd'], [1, 50, '#e2e8f0'], [1, 36, '#fca5a5'], [2, 46, '#86efac'], [0, 16, '#e2e8f0'],
  ]
  const gap = 7
  const period = lines.length * gap
  return (
    <>
      <rect width={100} height={100} fill="#1e2433" />
      {/* menu and toolbar */}
      <rect width={100} height={7} fill="#2d3548" />
      {[3, 10, 17, 24, 31].map(x => <rect key={x} x={x} y={2} width={5} height={3} fill="#94a3b8" />)}
      {/* navigator */}
      <rect x={0} y={7} width={22} height={70} fill="#151a26" />
      {[0, 1, 2, 3, 4, 5].map(i => (
        <g key={i}>
          <rect x={3} y={11 + i * 9} width={4} height={4} fill={i === 2 ? '#facc15' : '#64748b'} />
          <rect x={9} y={12 + i * 9} width={[10, 8, 11, 7, 9, 6][i]} height={2.5} fill="#94a3b8" />
        </g>
      ))}
      {/* code */}
      <svg x={24} y={9} width={76} height={66} viewBox="0 0 76 66" overflow="hidden">
        <g>
          {MOVE && <animateTransform attributeName="transform" type="translate" from="0 0" to={`0 ${-period}`} dur="5s" repeatCount="indefinite" />}
          {[...lines, ...lines].map(([indent, wd, colour], i) => (
            <rect key={i} x={4 + indent * 6} y={2 + i * gap} width={wd} height={3.4} fill={colour} />
          ))}
        </g>
      </svg>
      {/* toolbox: the compile result line */}
      <rect x={0} y={77} width={100} height={23} fill="#11151f" />
      <rect x={0} y={77} width={100} height={4} fill="#2d3548" />
      <rect x={4} y={85} width={56} height={3} fill="#94a3b8" />
      <rect x={4} y={92} width={36} height={3} fill="#22c55e">
        {MOVE && <animate attributeName="opacity" values="0;0;1;1" keyTimes="0;0.6;0.62;1" dur="5s" repeatCount="indefinite" />}
      </rect>
    </>
  )
}

/** The MT5 strategy tester: settings rows, a progress bar filling, a balance line drawing itself. */
export function StrategyTester({ tone = 'run' }: { tone?: 'run' | 'good' | 'bad' | 'idle' }) {
  const line = '6,74 14,70 20,72 28,63 36,66 44,57 52,60 60,50 68,53 76,44 84,47 94,38'
  const ink = tone === 'bad' ? '#ef4444' : tone === 'good' ? '#22c55e' : '#38bdf8'
  return (
    <>
      <rect width={100} height={100} fill="#0b1220" />
      {/* the settings tab */}
      <rect width={100} height={8} fill="#1e293b" />
      <rect x={3} y={2} width={16} height={4} fill="#facc15" />
      <rect x={22} y={2} width={14} height={4} fill="#475569" />
      <rect x={39} y={2} width={14} height={4} fill="#475569" />
      {/* the graph */}
      {[30, 45, 60, 75].map(y => <line key={y} x1={4} y1={y} x2={96} y2={y} stroke="#1c2a40" strokeWidth={1} />)}
      <polyline points={line} fill="none" stroke={ink} strokeWidth={2.2} strokeLinejoin="round"
        strokeDasharray={140} strokeDashoffset={MOVE && tone === 'run' ? 140 : 0}>
        {MOVE && tone === 'run' && <animate attributeName="stroke-dashoffset" values="140;0;0" keyTimes="0;0.85;1" dur="4s" repeatCount="indefinite" />}
      </polyline>
      {/* progress bar */}
      <rect x={4} y={86} width={92} height={7} fill="#1e293b" />
      <rect x={4} y={86} width={tone === 'run' ? 0 : 92} height={7} fill={tone === 'bad' ? '#b91c1c' : '#16a34a'}>
        {MOVE && tone === 'run' && <animate attributeName="width" values="0;92;92" keyTimes="0;0.85;1" dur="4s" repeatCount="indefinite" />}
      </rect>
    </>
  )
}
