/**
 * ProgressionSettings - the Settings panel's Progression section: on/off
 * (POST /progression/settings) and reset (POST /progression/reset, after a
 * confirm). Both need the UI token, so a read-only page shows them disabled.
 */

import React, { useEffect, useState } from 'react'
import { useProgression, loadProgression, setProgressionEnabled, resetProgression } from '../progression'

const ProgressionSettings: React.FC<{ disabled: boolean; reason?: string | null }> = ({ disabled, reason }) => {
  const s = useProgression()
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => { void loadProgression() }, [])
  const on = s.snapshot ? s.snapshot.enabled : null
  return (
    <section className="sp-section" aria-label="Progression" data-testid="sp-progression">
      <div className="sp-section-title">Progression</div>
      <div className="sp-row">
        <span className="sp-label" title="XP, levels, the trophy cabinet, unlockable furniture and the lessons binder, from real activity">XP, trophies &amp; unlocks</span>
        <button
          type="button" role="switch" aria-checked={on === true} aria-label="Progression"
          className={`sp-switch${on ? ' on' : ''}`} disabled={disabled || on === null}
          onClick={() => on !== null && void setProgressionEnabled(!on).then(ok => setNote(ok ? null : 'The server refused the change.'))}
          data-testid="sp-progression-toggle"
        >
          <span className="sp-switch-track"><span className="sp-switch-thumb" /></span>
          <span className="sp-switch-text">{on === null ? '—' : on ? 'On' : 'Off'}</span>
        </button>
      </div>
      <div className="sp-row">
        <span className="sp-label">Start over</span>
        {!confirming
          ? <button type="button" className="sp-link" disabled={disabled || on === null} onClick={() => setConfirming(true)} data-testid="sp-progression-reset">Reset progression…</button>
          : <span>
              <button type="button" className="sp-link sp-danger" onClick={() => { setConfirming(false); void resetProgression().then(ok => setNote(ok ? 'Progression reset: XP, trophies, unlocks, lessons and the garden are cleared.' : 'The server refused the reset.')) }} data-testid="sp-progression-reset-confirm">Wipe it</button>
              {' '}<button type="button" className="sp-link" onClick={() => setConfirming(false)}>Cancel</button>
            </span>}
      </div>
      {disabled && reason && <div className="sp-note">{reason}</div>}
      {note && <div className="sp-note">{note}</div>}
      <div className="sp-note">Off: nothing is counted and the props leave the room. Demo equity needs <code>progression.equityReports</code> in <code>office.config.json</code>.</div>
    </section>
  )
}

export default ProgressionSettings
