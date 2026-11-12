/**
 * ProgressionLayer - the progression layer in the room (server/progression.js):
 *
 *   trophy cabinet   each track's best trophy on its shelves; the rare finds on top
 *   mailbox          its flag is up while there are awards you have not opened
 *   lessons binder   on the counter, once something failed and then worked
 *   shipped bin      a parcel per merged PR or deploy (count on the tag)
 *   rooftop garden   the window box: a plant per merged PR
 *   backtest bay,    unlockable furniture: under a dust sheet with a padlock
 *   equity wall,     until earned, then the sheet lifts in a star burst
 *   money tree
 *
 * Rendered as siblings inside .room-container (a fragment), like
 * IncidentLayer, so each prop keeps its own z-index against furniture and
 * agents (z = its foot's y %, the furniture rule). Positions are % of the room.
 * Nothing is drawn while progression is off or the server has not answered.
 */

import React, { useEffect, useState } from 'react'
import {
  useProgression, loadProgression, openProgressionPanel, dismissToast, cabinetTrophies, gardenPlants, parcelsShown,
  hasNews, isUnlocked, isRevealing, artSize, xpProgress, SPRITES, TROPHY_SPRITES, SHEET_SPRITES, CABINET_SHELVES,
  PLANTER_SLOTS, BIN_PILE, TOAST_MS, REVEAL_MS, type Award, type PanelTab,
} from '../progression'
import '../styles/progression.css'

/** Where each prop's foot stands (% of the room) and how tall it is drawn (CSS px, like src/assets.ts heights). */
export const SPOTS = {
  cabinet: { x: 83.2, y: 67.5 },
  mailbox: { x: 62.4, y: 47.9 },
  binder: { x: 74.4, y: 48.6 },
  bin: { x: 14.6, y: 67.2 },
  planter: { x: 17.2, y: 57.4 },
  'backtest-bay': { x: 47.4, y: 88 },
  'equity-wall': { x: 39.6, y: 86.2 },
  'money-tree': { x: 6.8, y: 64.6 },
} as const

type UnlockId = 'mailbox' | 'lessons-binder' | 'shipped-bin' | 'rooftop-garden' | 'backtest-bay' | 'equity-wall' | 'money-tree'

const SHEET_FOR: Record<UnlockId, keyof typeof SHEET_SPRITES> = {
  mailbox: 'tall', 'lessons-binder': 'small', 'shipped-bin': 'medium', 'rooftop-garden': 'long',
  'backtest-bay': 'tall', 'equity-wall': 'medium', 'money-tree': 'medium',
}

const SPOT_FOR: Record<UnlockId, { x: number; y: number }> = {
  mailbox: SPOTS.mailbox, 'lessons-binder': SPOTS.binder, 'shipped-bin': SPOTS.bin, 'rooftop-garden': SPOTS.planter,
  'backtest-bay': SPOTS['backtest-bay'], 'equity-wall': SPOTS['equity-wall'], 'money-tree': SPOTS['money-tree'],
}

const MOVE = !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

/** A sprite at its art size, or scaled to `height` CSS px. */
function Sprite({ src, height, className, alt = '' }: { src: string; height?: number; className?: string; alt?: string }) {
  const s = artSize(src)
  const h = height ?? s.h
  return <img src={src} alt={alt} draggable={false} className={className} style={{ height: h, width: 'auto', imageRendering: 'pixelated', display: 'block' }} />
}

/** A prop standing at a spot: foot at (x, y), z by its y. */
function Prop({ spot, z, title, onClick, children, testId, className = '' }: {
  spot: { x: number; y: number }; z?: number; title?: string; onClick?: () => void; children: React.ReactNode; testId?: string; className?: string
}) {
  return (
    <div
      className={`prog-prop${onClick ? ' clickable' : ''} ${className}`}
      style={{ left: `${spot.x}%`, top: `${spot.y}%`, zIndex: z ?? Math.round(spot.y) }}
      title={title}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      data-testid={testId}
    >
      {children}
    </div>
  )
}

/** Eight stars and a popper flying out of a point (the unlock reveal), reusing upstream's effects. */
function StarBurst() {
  if (!MOVE) return <img className="prog-burst-still" src={SPRITES.star} alt="" />
  return (
    <div className="prog-burst" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <img key={i} src={SPRITES.star} alt="" style={{ ['--a' as string]: `${i * 45}deg` } as React.CSSProperties} />
      ))}
      <img className="prog-burst-party" src={SPRITES.party} alt="" />
    </div>
  )
}

/** A locked piece under its dust sheet, or (while it unlocks) the sheet lifting off it. */
function Covered({ id, unlocked, revealing, title, hint, children }: { id: UnlockId; unlocked: boolean; revealing: boolean; title: string; hint: string; children: React.ReactNode }) {
  const spot = SPOT_FOR[id]
  if (unlocked && !revealing) return <>{children}</>
  return (
    <>
      {unlocked && children}
      <Prop spot={spot} z={Math.round(spot.y) + 1} title={unlocked ? title : `Locked: ${title}. ${hint}`} onClick={() => openProgressionPanel('unlocks')} testId={`prog-locked-${id}`} className={revealing ? 'revealing' : 'locked'}>
        <div className="prog-sheet">
          <Sprite src={SHEET_SPRITES[SHEET_FOR[id]]} />
          {!revealing && <img className="prog-padlock" src={SPRITES.padlock} alt="locked" style={{ height: artSize(SPRITES.padlock).h }} />}
        </div>
        {revealing && <StarBurst />}
      </Prop>
    </>
  )
}

function awardIcon(a: Award): string {
  if (a.type === 'trophy' && a.tier) return TROPHY_SPRITES[a.tier]
  if (a.type === 'unlock') return a.rare ? SPRITES.gem : SPRITES.padlock
  if (a.type === 'level') return SPRITES.star
  return SPRITES.medal
}

const AWARD_KIND: Record<Award['type'], string> = { trophy: 'Trophy', milestone: 'Milestone', unlock: 'Unlocked', level: 'Level up' }

function Toasts({ toasts }: { toasts: Award[] }) {
  const first = toasts[0]
  useEffect(() => {
    if (!first) return
    const t = setTimeout(() => dismissToast(first.id), TOAST_MS)
    return () => clearTimeout(t)
  }, [first])
  if (!first) return null
  const tab: PanelTab = first.type === 'unlock' ? 'unlocks' : first.type === 'level' ? 'office' : 'trophies'
  return (
    <div className={`prog-toast ${first.type}${first.rare ? ' rare' : ''}`} onClick={() => { dismissToast(first.id); openProgressionPanel(tab) }} role="status" data-testid="prog-toast">
      <img src={awardIcon(first)} alt="" />
      <div>
        <div className="prog-toast-kind">{first.rare ? 'Rare · ' : ''}{AWARD_KIND[first.type]}{first.tier ? ` · ${first.tier}` : ''}</div>
        <div className="prog-toast-title">{first.title}</div>
        {first.detail && <div className="prog-toast-detail">{first.detail}</div>}
      </div>
      {toasts.length > 1 && <span className="prog-toast-more">+{toasts.length - 1}</span>}
    </div>
  )
}

const ProgressionLayer: React.FC = () => {
  const s = useProgression()
  const [, tick] = useState(0)
  useEffect(() => { void loadProgression() }, [])
  // Re-render as reveals and the +XP float run out
  useEffect(() => {
    const live = s.reveals.length || (s.lastGain && Date.now() - s.lastGain.at < 2500)
    if (!live) return
    const t = setTimeout(() => tick(n => n + 1), 400)
    return () => clearTimeout(t)
  })
  const snap = s.snapshot
  if (!snap || !snap.enabled) return null

  const now = Date.now()
  const unlocked = (id: string) => isUnlocked(snap, id)
  const revealing = (id: string) => isRevealing(s, id, now)
  const unlock = (id: string) => snap.unlocks.find(u => u.id === id)
  const trophies = cabinetTrophies(snap.tracks)
  const slots = CABINET_SHELVES.flat()
  const cab = artSize(SPRITES.cabinet)
  const news = hasNews(s)
  const gain = s.lastGain && now - s.lastGain.at < 2500 ? s.lastGain : null
  const rares = (['golden-bull', 'crown', 'gem'] as const).filter(unlocked)

  const cover = (id: UnlockId, children: React.ReactNode) => {
    const u = unlock(id)
    return <Covered key={id} id={id} unlocked={unlocked(id)} revealing={revealing(id)} title={u?.title ?? id} hint={u?.hint ?? ''}>{children}</Covered>
  }

  return (
    <>
      {/* Trophy cabinet: always there */}
      <Prop spot={SPOTS.cabinet} title={`Trophy cabinet · level ${snap.level} ${snap.title} · ${snap.xp} XP`} onClick={() => openProgressionPanel('trophies')} testId="prog-cabinet">
        <div className="prog-cabinet" style={{ width: cab.w, height: cab.h }}>
          <Sprite src={SPRITES.cabinet} />
          {trophies.map((t, i) => slots[i] && (
            <img key={t.track} className="prog-trophy" src={TROPHY_SPRITES[t.tier]} alt={`${t.title} (${t.tier})`} title={`${t.title} · ${t.tier}`}
              style={{ left: `${slots[i].x}%`, top: `${slots[i].y}%`, height: 11 }} />
          ))}
          <div className="prog-cabinet-top">
            {rares.map(r => <img key={r} src={r === 'golden-bull' ? SPRITES.bull : r === 'crown' ? SPRITES.crown : SPRITES.gem} alt={r} title={unlock(r)?.title} style={{ height: r === 'golden-bull' ? 22 : 12 }} />)}
          </div>
          <span className="prog-plate" data-testid="prog-level">LV {snap.level}</span>
          {gain && <span key={gain.at} className="prog-gain">+{gain.xp} XP</span>}
          <div className="prog-xpbar" aria-hidden="true"><i style={{ width: `${Math.round(xpProgress(snap) * 100)}%` }} /></div>
          {revealing('trophy-cabinet') && <StarBurst />}
        </div>
      </Prop>

      {cover('mailbox', (
        <Prop spot={SPOTS.mailbox} title={news ? 'News: awards you have not opened' : 'Mailbox: nothing new'} onClick={() => openProgressionPanel('today')} testId="prog-mailbox">
          <Sprite src={news ? SPRITES.mailboxUp : SPRITES.mailboxDown} alt={news ? 'mailbox, flag up' : 'mailbox'} />
        </Prop>
      ))}

      {cover('lessons-binder', (
        <Prop spot={SPOTS.binder} z={62} title={`Lessons binder · ${snap.counts.lesson ?? 0} filed`} onClick={() => openProgressionPanel('lessons')} testId="prog-binder">
          <Sprite src={SPRITES.binder} />
          {(snap.counts.lesson ?? 0) > 0 && <span className="prog-count">{snap.counts.lesson}</span>}
        </Prop>
      ))}

      {cover('shipped-bin', (
        <Prop spot={SPOTS.bin} title={`Shipped · ${snap.shipped} merged PRs and deploys`} onClick={() => openProgressionPanel('office')} testId="prog-bin">
          <div className="prog-bin">
            <Sprite src={SPRITES.bin} />
            {Array.from({ length: parcelsShown(snap.shipped) }, (_, i) => (
              <img key={i} className="prog-parcel" src={SPRITES.parcel} alt=""
                style={{ left: `calc(${BIN_PILE.x}% + ${((i % 3) - 1) * 7}px)`, top: `calc(${BIN_PILE.y}% - ${Math.floor(i / 3) * 6 + (i % 2) * 2}px)`, height: artSize(SPRITES.parcel).h }} />
            ))}
            <span className="prog-tag">SHIPPED {snap.shipped}</span>
          </div>
        </Prop>
      ))}

      {cover('rooftop-garden', (
        <Prop spot={SPOTS.planter} title={`Rooftop garden · ${snap.garden.total} merged PR${snap.garden.total === 1 ? '' : 's'}`} onClick={() => openProgressionPanel('office')} testId="prog-garden">
          <div className="prog-planter">
            {gardenPlants(snap.garden.plants).map(p => PLANTER_SLOTS[p.slot] && (
              <img key={p.key} className="prog-plant" src={p.sprite} alt={p.label} title={p.label}
                style={{ left: `${PLANTER_SLOTS[p.slot].x}%`, top: `${PLANTER_SLOTS[p.slot].y}%`, height: artSize(p.sprite).h }} />
            ))}
            {unlocked('clover') && PLANTER_SLOTS[11] && <img className="prog-plant" src={SPRITES.clover} alt="four-leaf clover" title="Four-leaf clover (rare)" style={{ left: `${PLANTER_SLOTS[11].x}%`, top: `${PLANTER_SLOTS[11].y}%`, height: 12 }} />}
            <Sprite src={SPRITES.planter} />
          </div>
        </Prop>
      ))}

      {cover('backtest-bay', (
        <Prop spot={SPOTS['backtest-bay']} title={`Backtest bay · ${snap.counts.mt5_run ?? 0} MT5 tester runs, ${snap.counts.walk_forward ?? 0} walk-forward`} onClick={() => openProgressionPanel('trophies')} testId="prog-rack">
          <Sprite src={SPRITES.rack} height={74} />
          <span className="prog-leds" aria-hidden="true" />
        </Prop>
      ))}

      {cover('equity-wall', (
        <Prop spot={SPOTS['equity-wall']} title={snap.equity.high !== null ? `Demo equity high: ${snap.equity.high.toFixed(2)} (from your MT5 report)` : 'Equity wall'} onClick={() => openProgressionPanel('trophies')} testId="prog-equity">
          <Sprite src={SPRITES.equity} height={44} />
          {snap.equity.high !== null && <span className="prog-tag">{snap.equity.high.toFixed(0)}</span>}
        </Prop>
      ))}

      {cover('money-tree', (
        <Prop spot={SPOTS['money-tree']} title="Money tree (level 5)" testId="prog-money-tree">
          <Sprite src={SPRITES.moneyTree} height={58} />
        </Prop>
      ))}

      <Toasts toasts={s.toasts} />
    </>
  )
}

export { REVEAL_MS }
export default ProgressionLayer
