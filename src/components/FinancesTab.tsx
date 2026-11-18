/**
 * FinancesTab.tsx - the firm's books in the progression panel: cash in hand,
 * where the money came from, and the balance day by day.
 *
 * The numbers are the server's (server/progression.js finances()); the
 * geometry is cashChart() in src/progression.ts, so the tests can check it.
 */

import React, { useState } from 'react'
import { cashChart, incomeRows, money, type ProgressionSnapshot } from '../progression'

const W = 300
const H = 96

const shortDay = (date: string) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString([], { day: 'numeric', month: 'short' }) }
const when = (t: number) => {
  const d = new Date(t)
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function CashChart({ days }: { days: NonNullable<ProgressionSnapshot['finances']>['days'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const c = cashChart(days, W, H)
  const at = hover !== null ? c.points[hover] : null
  const day = hover !== null ? days[hover] : null
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    let best = 0
    c.points.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(c.points[best].x - x)) best = i })
    setHover(best)
  }
  return (
    <div className="pf-chart" data-testid="finances-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cash in hand over the last ${days.length} days`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="pf-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7fd48a" stopOpacity="0.32" />
            <stop offset="1" stopColor="#7fd48a" stopOpacity="0" />
          </linearGradient>
        </defs>
        {c.ticks.map(t => (
          <g key={t.value}>
            <line x1={c.left} x2={W} y1={t.y} y2={t.y} className="pf-grid" />
            <text x={c.left - 4} y={t.y + 2.5} textAnchor="end" className="pf-axis">{t.label}</text>
          </g>
        ))}
        <path d={c.area} fill="url(#pf-fill)" />
        <path d={c.line} className="pf-line" />
        {at && <line x1={at.x} x2={at.x} y1={c.top} y2={c.bottom} className="pf-cross" />}
        {(at ?? c.points[c.points.length - 1]) && (() => { const p = at ?? c.points[c.points.length - 1]; return <circle cx={p.x} cy={p.y} r="2.6" className="pf-dot" /> })()}
        <text x={c.left} y={H - 1} className="pf-axis">{shortDay(days[0].date)}</text>
        <text x={W} y={H - 1} textAnchor="end" className="pf-axis">{shortDay(days[days.length - 1].date)}</text>
      </svg>
      {at && day && (
        <div className="pf-tip" style={{ left: `${(at.x / W) * 100}%`, top: `${(at.y / H) * 100}%` }} data-side={at.x > W * 0.6 ? 'left' : 'right'}>
          <b>{money(day.balance)}</b>
          <span>{shortDay(day.date)}</span>
          {(day.in > 0 || day.out > 0) && <span>{day.in > 0 ? `+${money(day.in)}` : ''}{day.in > 0 && day.out > 0 ? ' · ' : ''}{day.out > 0 ? `spent ${money(day.out)}` : ''}</span>}
        </div>
      )}
    </div>
  )
}

const FinancesTab: React.FC<{ snap: ProgressionSnapshot }> = ({ snap }) => {
  const f = snap.finances
  const rows = incomeRows(f?.sources)
  const earned = rows.reduce((n, r) => n + r.amount, 0)
  return (
    <div data-testid="prog-tab-finances">
      <div className="pf-tiles">
        <div className="pf-tile main"><span>Cash in hand</span><b data-testid="finances-cash">{money(snap.cash)}</b></div>
        <div className="pf-tile"><span>Earned</span><b>{money(earned)}</b></div>
        <div className="pf-tile"><span>Spent</span><b>{money(f?.spent ?? 0)}</b></div>
      </div>

      <div className="pp-sub">Cash in hand{f && f.days.length > 1 ? `, last ${f.days.length} days` : ''}</div>
      {f && f.days.length > 1
        ? <CashChart days={f.days} />
        : <div className="pp-dim">The chart starts once the firm has a second day on the books.</div>}

      <div className="pp-sub">Where the money came from</div>
      <ul className="pf-sources">
        {rows.map(r => (
          <li key={r.id} data-testid={`finances-source-${r.id}`}>
            <span className="pf-name">{r.label}</span>
            <span className="pf-bar"><i style={{ width: `${r.share * 100}%` }} /></span>
            <b>{money(r.amount)}</b>
            <span className="pf-pct">{earned ? `${Math.round((r.amount / earned) * 100)}%` : ''}</span>
          </li>
        ))}
      </ul>
      {earned === 0 && <div className="pp-dim">Nothing yet: research pays, and so does a new equity high on an account report.</div>}

      <div className="pp-sub">Money in and out</div>
      <ul className="pp-list">
        {(snap.ledger ?? []).slice(0, 12).map((r, i) => <li key={i} className="pp-row"><span className={`pp-xp ${r.amount < 0 ? 'pp-spent' : 'pp-cash'}`}>{r.amount > 0 ? '+' : ''}{money(r.amount)}</span><span className="pp-what">{r.amount < 0 ? `bought: ${r.label ?? ''}` : (r.label ?? r.kind)}</span><span className="pp-dim pp-when">{when(r.at)}</span></li>)}
      </ul>
      <div className="pp-note">Demo accounts pay the firm {Math.round((snap.cashRules?.profitShare?.demo ?? 0.1) * 100)}% of each new equity high and live accounts {Math.round((snap.cashRules?.profitShare?.live ?? 0.5) * 100)}%. A drawdown costs nothing.</div>
    </div>
  )
}

export default FinancesTab
