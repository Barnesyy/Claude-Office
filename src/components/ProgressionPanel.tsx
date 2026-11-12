/**
 * ProgressionPanel - the progression book (server/progression.js) as a
 * popover: Office (level, XP, streak, recent gains), Trophies (tracks and
 * milestones), Unlocks, Lessons (the binder), Today (the daily recap) and
 * Quarter (the quarterly review). Opened from the status strip's level
 * button and from the props in the room (src/components/ProgressionLayer.tsx).
 * Read-only data: it shows the same on a read-only page.
 */

import React, { useEffect, useRef, useState } from 'react'
import {
  useProgression, closeProgressionPanel, openProgressionPanel, fetchDay, fetchQuarter, xpProgress, kindRows, formatDuration,
  quarterOf, previousQuarter, TROPHY_SPRITES, SPRITES, TIERS,
  type DayReport, type QuarterReport, type PanelTab, type ProgressionSnapshot,
  quarterMonths,
} from '../progression'
import '../styles/settings.css'
import '../styles/progression.css'

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'office', label: 'Office' }, { id: 'trophies', label: 'Trophies' }, { id: 'unlocks', label: 'Unlocks' },
  { id: 'lessons', label: 'Lessons' }, { id: 'today', label: 'Today' }, { id: 'quarter', label: 'Quarter' },
]

const when = (t: number | null | undefined) => {
  if (!t) return ''
  const d = new Date(t)
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const dayLabel = (date: string) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) }

function OfficeTab({ snap }: { snap: ProgressionSnapshot }) {
  return (
    <div data-testid="prog-tab-office">
      <div className="pp-level">
        <div className="pp-level-badge">LV<b>{snap.level}</b></div>
        <div className="pp-level-body">
          <div className="pp-level-title">{snap.title}</div>
          <div className="pp-bar"><i style={{ width: `${Math.round(xpProgress(snap) * 100)}%` }} /></div>
          <div className="pp-dim">{snap.xp} XP · next level at {snap.nextLevelXp} · today +{snap.todayXp} · streak {snap.streak} day{snap.streak === 1 ? '' : 's'}</div>
        </div>
      </div>
      <dl className="pp-grid">
        <dt>Shipped (PRs + deploys)</dt><dd>{snap.shipped}</dd>
        <dt>Rooftop garden</dt><dd>{snap.garden.total} plant{snap.garden.total === 1 ? '' : 's'}</dd>
        <dt>Lessons filed</dt><dd>{snap.counts.lesson ?? 0}</dd>
        <dt>MT5 tester runs</dt><dd>{snap.counts.mt5_run ?? 0} ({snap.counts.walk_forward ?? 0} walk-forward)</dd>
        <dt>Demo equity high</dt><dd>{snap.equity.high !== null ? snap.equity.high.toFixed(2) : <span className="pp-dim">no MT5 report configured</span>}</dd>
      </dl>
      <div className="pp-sub">Recent XP</div>
      {snap.recent.length === 0 && <div className="pp-dim">Nothing yet: finish a turn, run the tests, merge a PR.</div>}
      <ul className="pp-list">
        {snap.recent.slice(0, 8).map((r, i) => <li key={i} className="pp-row"><span className="pp-xp">+{r.xp}</span><span className="pp-what">{r.label ?? r.kind}</span><span className="pp-dim pp-when">{when(r.at)}</span></li>)}
      </ul>
      <div className="pp-note">XP shrinks the more of one thing you do in a day, repeats within 90 s count nothing, and failures earn none.</div>
    </div>
  )
}

function TrophiesTab({ snap }: { snap: ProgressionSnapshot }) {
  return (
    <div data-testid="prog-tab-trophies">
      <div className="pp-tracks">
        {snap.tracks.map(t => (
          <div key={t.id} className="pp-track">
            <div className="pp-track-head"><span>{t.title}</span><span className="pp-dim">{t.count}</span></div>
            <div className="pp-tiers">
              {t.tiers.map(x => (
                <span key={x.tier} className={`pp-tier${x.earned ? ' earned' : ''}`} title={`${x.tier}: ${x.threshold}${x.earned ? ` · ${when(x.at)}` : ''}`}>
                  <img src={TROPHY_SPRITES[x.tier]} alt={x.tier} />
                  <small>{x.threshold}</small>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="pp-sub">Milestones</div>
      <ul className="pp-list pp-milestones">
        {snap.milestones.map(m => (
          <li key={m.id} className={m.earned ? 'earned' : ''}><img src={SPRITES.medal} alt="" /> <b>{m.title}</b> <span className="pp-dim">{m.detail}{m.earned ? ` · ${when(m.at)}` : ''}</span></li>
        ))}
      </ul>
    </div>
  )
}

function UnlocksTab({ snap }: { snap: ProgressionSnapshot }) {
  return (
    <ul className="pp-list pp-unlocks" data-testid="prog-tab-unlocks">
      {snap.unlocks.map(u => (
        <li key={u.id} className={`${u.unlocked ? 'earned' : ''}${u.rare ? ' rare' : ''}`}>
          <img src={u.unlocked ? (u.rare ? SPRITES.gem : SPRITES.star) : SPRITES.padlock} alt="" />
          <b>{u.title}</b> <span className="pp-dim">{u.unlocked ? `${u.detail} · ${when(u.at)}` : u.hint}</span>
        </li>
      ))}
    </ul>
  )
}

function LessonsTab({ snap }: { snap: ProgressionSnapshot }) {
  if (!snap.lessons.length) return <div className="pp-dim" data-testid="prog-tab-lessons">The binder is empty. A lesson is filed when something fails and then works in the same session.</div>
  return (
    <ul className="pp-list pp-lessons" data-testid="prog-tab-lessons">
      {snap.lessons.map(l => (
        <li key={l.id}><b>{l.label}</b> <span className="pp-dim">failed {l.fails}×, fixed in {formatDuration(l.ms)} · {dayLabel(l.date)}</span></li>
      ))}
    </ul>
  )
}

function TodayTab() {
  const [d, setD] = useState<DayReport | null | undefined>(undefined)
  useEffect(() => { let on = true; void fetchDay().then(r => on && setD(r)); return () => { on = false } }, [])
  if (d === undefined) return <div className="pp-dim">Counting…</div>
  if (!d) return <div className="pp-dim">The office server is not answering.</div>
  const recap = d.recap
  return (
    <div data-testid="prog-tab-today">
      <div className="pp-headline">{dayLabel(d.date)} · <b>+{d.xp} XP</b></div>
      <table className="pp-table"><tbody>
        {kindRows(d.kinds).map(r => <tr key={r.kind} className={`tone-${r.tone}`}><td>{r.label}</td><td>{r.count}</td><td>{r.xp ? `+${r.xp}` : ''}</td></tr>)}
      </tbody></table>
      {kindRows(d.kinds).length === 0 && <div className="pp-dim">Nothing on the books yet today.</div>}
      {recap && <div className="pp-dim pp-recap">Office: {String(recap.sessions)} sessions · {String(recap.agentsSpawned)} agents hired · {String(recap.incidents)} incidents{Number(recap.costUsd) > 0 ? ` · payroll $${Number(recap.costUsd).toFixed(2)}` : ''}</div>}
      {d.awards.length > 0 && <><div className="pp-sub">Earned today</div><ul className="pp-list">{d.awards.map(a => <li key={a.id}><b>{a.title}</b>{a.tier ? ` · ${a.tier}` : ''} <span className="pp-dim">{a.type}</span></li>)}</ul></>}
      {d.lessons.length > 0 && <><div className="pp-sub">Lessons today</div><ul className="pp-list">{d.lessons.map(l => <li key={l.id}>{l.label} <span className="pp-dim">failed {l.fails}×</span></li>)}</ul></>}
    </div>
  )
}

function QuarterTab() {
  const [q, setQ] = useState(() => quarterOf(new Date()))
  const [r, setR] = useState<QuarterReport | null | undefined>(undefined)
  useEffect(() => { let on = true; setR(undefined); void fetchQuarter(q).then(x => on && setR(x)); return () => { on = false } }, [q])
  const current = quarterOf(new Date())
  const next = (() => { const y = Number(q.slice(0, 4)); const n = Number(q.slice(-1)); return n === 4 ? `${y + 1}-Q1` : `${y}-Q${n + 1}` })()
  const months: [string, number][] = r ? quarterMonths(r.from).map(m => [m, r.byMonth[m] ?? 0]) : []
  const peak = Math.max(1, ...months.map(([, v]) => v))
  return (
    <div data-testid="prog-tab-quarter">
      <div className="pp-qnav">
        <button type="button" onClick={() => setQ(previousQuarter(q))} aria-label="Previous quarter">‹</button>
        <b>{q}</b>
        <button type="button" onClick={() => setQ(next)} disabled={q === current} aria-label="Next quarter">›</button>
      </div>
      {r === undefined && <div className="pp-dim">Adding it up…</div>}
      {r === null && <div className="pp-dim">The office server is not answering.</div>}
      {r && (
        <>
          <dl className="pp-grid">
            <dt>XP</dt><dd>{r.xp}</dd>
            <dt>Active days</dt><dd>{r.activeDays}</dd>
            <dt>Best day</dt><dd>{r.bestDay ? `${dayLabel(r.bestDay.date)} (+${r.bestDay.xp})` : '—'}</dd>
            <dt>Green rate (tests + builds)</dt><dd>{r.greenRate === null ? '—' : `${r.greenRate}%`}</dd>
            <dt>Lessons</dt><dd>{r.lessons}</dd>
          </dl>
          {months.length > 0 && <div className="pp-months">{months.map(([m, v]) => <div key={m} className="pp-month"><i style={{ height: `${Math.round((v / peak) * 100)}%` }} title={`${v} XP`} /><small>{new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1).toLocaleDateString([], { month: 'short' })}</small></div>)}</div>}
          <table className="pp-table"><tbody>
            {kindRows(r.kinds).map(k => <tr key={k.kind} className={`tone-${k.tone}`}><td>{k.label}</td><td>{k.count}</td><td>{k.xp ? `+${k.xp}` : ''}</td></tr>)}
          </tbody></table>
          {r.topLessons.length > 0 && <><div className="pp-sub">Most-learned lessons</div><ul className="pp-list">{r.topLessons.map(l => <li key={l.label}>{l.label} <span className="pp-dim">×{l.n}</span></li>)}</ul></>}
          {r.awards.length > 0 && <><div className="pp-sub">Earned this quarter</div><div className="pp-awards">{r.awards.map(a => <span key={a.id} className={`pp-chip ${a.type}`} title={a.type}>{a.tier && <img src={TROPHY_SPRITES[a.tier as keyof typeof TROPHY_SPRITES]} alt="" />}{a.title}</span>)}</div></>}
        </>
      )}
    </div>
  )
}

const ProgressionPanel: React.FC = () => {
  const s = useProgression()
  const ref = useRef<HTMLDivElement>(null)
  const tab = s.panel
  useEffect(() => {
    if (!tab) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeProgressionPanel() }
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (ref.current?.contains(t) || t.closest?.('.prog-prop, .strip-level, .prog-toast')) return
      closeProgressionPanel()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [tab])
  if (!tab) return null
  const snap = s.snapshot
  return (
    <div className="progression-panel office-popover" role="dialog" aria-label="Office progression" ref={ref} data-testid="progression-panel">
      <div className="op-head">
        <span className="op-title">Progression{snap ? ` · LV ${snap.level} ${snap.title}` : ''}</span>
        <button className="op-close" onClick={closeProgressionPanel} aria-label="Close">×</button>
      </div>
      <div className="pp-tabs" role="tablist">
        {TABS.map(t => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => openProgressionPanel(t.id)} data-testid={`prog-tab-btn-${t.id}`}>{t.label}</button>)}
      </div>
      <div className="pp-body">
        {!snap && <div className="op-note">Loading…</div>}
        {snap && !snap.enabled && <div className="op-note">Progression is off. Turn it on in Settings.</div>}
        {snap && snap.enabled && tab === 'office' && <OfficeTab snap={snap} />}
        {snap && snap.enabled && tab === 'trophies' && <TrophiesTab snap={snap} />}
        {snap && snap.enabled && tab === 'unlocks' && <UnlocksTab snap={snap} />}
        {snap && snap.enabled && tab === 'lessons' && <LessonsTab snap={snap} />}
        {snap && snap.enabled && tab === 'today' && <TodayTab />}
        {snap && snap.enabled && tab === 'quarter' && <QuarterTab />}
      </div>
      <div className="op-foot">From your real sessions only · {TIERS.join(' / ')} tiers · nothing here leaves this machine</div>
    </div>
  )
}

export default ProgressionPanel
